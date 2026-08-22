// Empire-scoped inter-colony resource transfer (gh #59, docs/empire-logistics-plan.md) — supersedes
// boosting-reactions-plan.md's M2 (empire assignment algorithm, dropped entirely) and M4 (terminal
// distribution, this is that mechanism). Two pure functions: computeEmpireRequests reads live
// storage+terminal stock against an empire-owned, role-biased target and emits a signed EmpireRequest per
// colony per resource (decision 2/4); matchEmpireRequests pairs the biggest surplus against the biggest
// deficit per resource (decision 5), capped by congestion (decision 12) and send-cost accounting
// (decision 8), leaving anything unpaired for the market-fallback phase (gh #60, empire/marketFallback.ts).
//
// Data source is live Game.* (storage/terminal .store), not ColonySnapshot — an explicit extension of ADR
// 0008's src/logistics/ self-registration carve-out to empire scope (decision 9). This module itself takes
// plain EmpireStock-shaped stubs so it stays unit-testable without a live Game.rooms lookup (same
// "fake the store surface" pattern stewardRegister.test.ts already established) — the Game.* read/dispatch
// glue lives in the tier-3 SYSTEMS entry that calls this (kernel/tick.ts), not here.

import type { ColonyRole } from "../memory/schema";
import type { Intent } from "../intents/types";
import { BOOST_TARGETS } from "./boostTargets";
import { MARKET_TRADING_ENABLED, marketFallback } from "./marketFallback";

/** One signed unit of empire-scale transport demand — mirrors LogisticsRequest's shape (positive = wants
 * delivered, negative = has to give) but scoped to a colony rather than a live in-room target, and with no
 * dAmountdt/multiplier fields: there's no known empire-scale accrual rate, and the role-multiplier bias
 * already lives inside how `amount` itself is computed (effectiveTarget), not a separate scoring factor
 * applied afterward. Exists independently of any match — the same unmatched want/have list a
 * colony-to-colony match couldn't pair is handed directly to marketFallback. */
export interface EmpireRequest {
  colony: string; // bare room-name string, resolved back to Game.rooms[...] only at dispatch time
  resource: ResourceConstant;
  amount: number;
}

/** The minimal live-store surface this module reads — satisfied by a real StructureStorage/StructureTerminal
 * (both expose .store.getUsedCapacity) or a plain test stub. */
export interface EmpireStock {
  getUsedCapacity(resource: ResourceConstant): number;
}

/** One colony's live stock handles, as read at match-time. Either structure may be absent (not yet built);
 * absent reads as zero stock there, not a crash — a colony with no terminal yet still has a computable
 * storage-only deficit. */
export interface ColonyEmpireStock {
  colony: string;
  storage: EmpireStock | undefined;
  terminal: EmpireStock | undefined;
}

// roleMultiplierFor's bias factors — a frontline colony's inflated target surfaces as a bigger deficit and
// naturally sorts to the front of matchEmpireRequests' queue (decision 5), no separate priority tier needed
// on top. Exact magnitudes aren't load-bearing design decisions, just a starting bias.
const FRONTLINE_MULTIPLIER = 1.5;
const BACKLINE_MULTIPLIER = 0.5;
const NEUTRAL_MULTIPLIER = 1.0;

/** ColonyMemory.empireRole -> roleMultiplier (decision 3): undefined (never manually set) defaults to
 * neutral (1.0), same as every colony until explicitly flagged via console command. */
export function roleMultiplierFor(role: ColonyRole | undefined): number {
  if (role === "frontline") return FRONTLINE_MULTIPLIER;
  if (role === "backline") return BACKLINE_MULTIPLIER;
  return NEUTRAL_MULTIPLIER;
}

/** effectiveTarget = baseTarget(resource, boostLine) x roleMultiplier(colony) (decision 2). */
export function effectiveTargetFor(baseTarget: number, role: ColonyRole | undefined): number {
  return baseTarget * roleMultiplierFor(role);
}

/**
 * For every colony and every resource with a configured base target (see empire/boostTargets.ts),
 * compares live storage+terminal stock against that colony's effectiveTarget and emits a signed
 * EmpireRequest for the surplus or deficit. A colony sitting exactly at target emits nothing for that
 * resource — there's no useful request to make either direction. `roleOf` is injected (rather than read
 * from Memory directly) so this stays a pure function over plain stubs in tests; the tier-3 caller passes
 * `room => Memory.colonies[room]?.empireRole`.
 */
export function computeEmpireRequests(
  colonies: readonly ColonyEmpireStock[],
  targets: Partial<Record<ResourceConstant, number>>,
  roleOf: (colony: string) => ColonyRole | undefined
): EmpireRequest[] {
  const out: EmpireRequest[] = [];
  const resources = Object.keys(targets) as ResourceConstant[];
  for (const c of colonies) {
    const role = roleOf(c.colony);
    for (const resource of resources) {
      const baseTarget = targets[resource];
      if (baseTarget == null) continue;
      const effectiveTarget = effectiveTargetFor(baseTarget, role);
      const stock = (c.storage?.getUsedCapacity(resource) ?? 0) + (c.terminal?.getUsedCapacity(resource) ?? 0);
      const amount = effectiveTarget - stock;
      if (amount === 0) continue;
      out.push({ colony: c.colony, resource, amount });
    }
  }
  return out;
}

/** One decided colony-to-colony transfer, ready for the dispatch glue to issue as terminal.send(). */
export interface EmpireTransfer {
  from: string;
  to: string;
  resource: ResourceConstant;
  amount: number;
}

/** No fee carve-out needed unless the shipped resource IS energy (decision 8) — sendCost is always
 * denominated in energy, so a non-energy send pays its fee from the terminal's separate energy floor
 * instead (Steward's ordinary top-up keeps that floor stocked), not out of the amount being shipped. */
const NO_SEND_COST = (): number => 0;

/** Prices a send's fee (Game.market.calcTransactionCost) given the real from/to pair a match decided on —
 * only ever consulted by matchEmpireRequests when resource === RESOURCE_ENERGY (decision 8). */
export type SendCost = (amount: number, from: string, to: string) => number;

/**
 * Pairwise sort-and-match (decision 5): for each resource, pair the request with the largest surplus
 * (most negative amount) against the one with the largest deficit (most positive amount), repeat among
 * whatever's left, skip once no more opposite-signed pair exists (self-pairing within one colony is not
 * possible — requests are already grouped by colony as they're consumed). `receiverFreeCapacity(colony,
 * resource)` prices the congestion cap (decision 12): `min(sender's sendable surplus, receiver's deficit,
 * receiver's terminal free capacity)`. `sendCost(amount)` (decision 8) is only ever applied when
 * `resource === RESOURCE_ENERGY` — every other resource ships the congestion-capped amount unshrunk.
 * Anything left unpaired (no opposite-signed match, or a computed amount <= 0) is returned as `leftover`
 * for the market-fallback phase (decision 13) to consume — a resource whose deficit isn't fully met by one
 * match round simply keeps its remainder as leftover too, resolved incrementally on a later pass rather
 * than requiring a full-satisfaction search here.
 */
export function matchEmpireRequests(
  requests: readonly EmpireRequest[],
  receiverFreeCapacity: (colony: string, resource: ResourceConstant) => number,
  sendCost: SendCost = NO_SEND_COST
): { matches: EmpireTransfer[]; leftover: EmpireRequest[] } {
  const byResource = new Map<ResourceConstant, EmpireRequest[]>();
  for (const r of requests) {
    if (r.amount === 0) continue;
    const list = byResource.get(r.resource) ?? [];
    list.push(r);
    byResource.set(r.resource, list);
  }

  const matches: EmpireTransfer[] = [];
  const leftover: EmpireRequest[] = [];

  for (const [resource, list] of byResource) {
    // Mutable per-request remaining amount, so a partially-consumed surplus/deficit can still be re-ranked
    // against the next-largest opposite-signed request in the same resource's pass.
    const remaining = list.map(r => ({ ...r }));

    for (;;) {
      let surplusIdx = -1;
      let deficitIdx = -1;
      for (let i = 0; i < remaining.length; i++) {
        const r = remaining[i];
        if (r.amount === 0) continue;
        if (r.amount < 0 && (surplusIdx === -1 || r.amount < remaining[surplusIdx].amount)) surplusIdx = i;
        if (r.amount > 0 && (deficitIdx === -1 || r.amount > remaining[deficitIdx].amount)) deficitIdx = i;
      }
      if (surplusIdx === -1 || deficitIdx === -1) break;

      const sender = remaining[surplusIdx];
      const receiver = remaining[deficitIdx];
      if (sender.colony === receiver.colony) break; // no other opposite-signed pair left to try this pass

      const senderSurplus = -sender.amount;
      const freeCapacity = receiverFreeCapacity(receiver.colony, resource);
      // The congestion cap (decision 12): how much of this pairing is resolved between the two colonies,
      // BEFORE any energy send-fee carve-out — the fee is overhead lost to the transaction, not an amount
      // still owed, so both sides' remaining deficit/surplus are cleared by cappedAmount regardless of
      // what the actual dispatched send ends up being after the fee (decision 8) shrinks it.
      const cappedAmount = Math.min(senderSurplus, receiver.amount, freeCapacity);
      const amount =
        resource === RESOURCE_ENERGY ? cappedAmount - sendCost(cappedAmount, sender.colony, receiver.colony) : cappedAmount;

      if (cappedAmount <= 0 || amount <= 0) {
        // This pair can't move anything right now (e.g. receiver's terminal has no free capacity) —
        // stop matching this resource; both remain as leftover along with everything else still unmatched.
        break;
      }

      matches.push({ from: sender.colony, to: receiver.colony, resource, amount });
      sender.amount += cappedAmount; // moves toward 0 (less negative)
      receiver.amount -= cappedAmount;
    }

    for (const r of remaining) if (r.amount !== 0) leftover.push({ colony: r.colony, resource, amount: r.amount });
  }

  return { matches, leftover };
}

// Tier-3 SYSTEMS interval (kernel/tick.ts), ~TERMINAL_COOLDOWN-scaled (decision 10): any single terminal
// can only send once per TERMINAL_COOLDOWN ticks regardless, so a full pass every tick would waste CPU
// recomputing decisions that can't act yet. Exported so the SYSTEMS entry can't drift from this number,
// same pattern as market.ts's MARKET_SCAN_INTERVAL.
export const EMPIRE_LOGISTICS_INTERVAL = TERMINAL_COOLDOWN + 1;

/**
 * The tier-3 entry point (Game-coupled, left UNTESTED — same precedent as
 * behaviors/stewardTaskRunner.ts's dispatch glue / test/unit/logistics/stewardRegister.test.ts's own
 * header note on why): reads every colony's live storage+terminal stock, computes and matches
 * EmpireRequests (decisions 2/5), then turns each match into a `terminalSend` intent PLUS a
 * `setEmpireReservations` intent per sending colony (decision 6).
 *
 * Cooldown handling (decision 11 — a cooldown-blocked match is dropped, not persisted, and recomputed
 * fresh next pass): a colony whose terminal is currently on cooldown is excluded from `sendableSet`, and
 * its surplus (a "has to give" request, amount <= 0) is filtered out of `requests` before matching ever
 * runs — it simply isn't offered as a candidate sender this pass. It's still included as a potential
 * RECEIVER (a deficit is real regardless of its own terminal's cooldown), since cooldown only blocks
 * SENDING, not receiving.
 */
export function runEmpireLogisticsPass(colonyNames: readonly string[]): Intent[] {
  const sendableSet = new Set(colonyNames.filter(name => (Game.rooms[name]?.terminal?.cooldown ?? 0) === 0));

  const stocks: ColonyEmpireStock[] = colonyNames.map(name => ({
    colony: name,
    storage: Game.rooms[name]?.storage?.store,
    terminal: Game.rooms[name]?.terminal?.store
  }));
  // A colony whose terminal is on cooldown can still be a RECEIVER this pass (its deficit is real) but
  // must not be offered as a SURPLUS candidate (decision 11: a cooldown-blocked match is dropped, not
  // persisted) — its surplus request (amount <= 0, "has to give") is filtered out here, before matching,
  // rather than zeroing its stock reads (which would corrupt its own deficit computation instead).
  const requests = computeEmpireRequests(stocks, BOOST_TARGETS, name => Memory.colonies[name]?.empireRole).filter(
    r => r.amount > 0 || sendableSet.has(r.colony)
  );

  const receiverFreeCapacity = (colony: string, resource: ResourceConstant): number =>
    Game.rooms[colony]?.terminal?.store.getFreeCapacity(resource) ?? 0;
  const sendCost: SendCost = (amount, from, to) => Game.market.calcTransactionCost(amount, from, to);

  const { matches, leftover } = matchEmpireRequests(requests, receiverFreeCapacity, sendCost);

  const intents: Intent[] = [];
  const reservations = new Map<string, Partial<Record<ResourceConstant, number>>>();
  for (const m of matches) {
    intents.push({ kind: "terminalSend", from: m.from, to: m.to, resource: m.resource, amount: m.amount });
    const colonyReservations = reservations.get(m.from) ?? {};
    colonyReservations[m.resource] = (colonyReservations[m.resource] ?? 0) + m.amount;
    reservations.set(m.from, colonyReservations);
  }
  // Every colony gets a fresh (possibly empty) reservations write, not just senders with a match — a
  // colony that WAS reserving for a resource last pass but has nothing matched this pass must have that
  // stale entry cleared, per decision 11's "recompute fresh, no persisted intent" (see
  // ColonyMemory.empireReservations's own doc).
  for (const name of colonyNames) {
    intents.push({ kind: "setEmpireReservations", room: name, reservations: reservations.get(name) ?? {} });
  }

  // gh #60: market-fallback phase (docs/market-plan.md) — whatever couldn't be paired colony-to-colony
  // gets resolved against the real market instead. Same cadence as the match pass above (decision 2), a
  // pure continuation of the same decision. Compiled out (MARKET_TRADING_ENABLED false) on every build but
  // push-main — never runs against a local pserver's meaningless market.
  if (MARKET_TRADING_ENABLED) {
    const terminalCapacityPct = (colony: string, resource: ResourceConstant): number => {
      const terminal = Game.rooms[colony]?.terminal;
      if (!terminal) return 0;
      return terminal.store.getUsedCapacity(resource) / terminal.store.getCapacity(resource);
    };
    const market = Memory.stats.market;
    const myOrders = Object.values(Game.market.orders).map(o => ({
      id: o.id,
      type: o.type === ORDER_BUY ? ("buy" as const) : ("sell" as const),
      resourceType: o.resourceType as ResourceConstant,
      roomName: o.roomName,
      remainingAmount: o.remainingAmount,
      price: o.price
    }));
    const bestBuyOrder = (resource: ResourceConstant): { id: string; price: number } | undefined => {
      let best: { id: string; price: number } | undefined;
      for (const o of Game.market.getAllOrders({ type: ORDER_BUY, resourceType: resource })) {
        if (!best || o.price > best.price) best = { id: o.id, price: o.price };
      }
      return best;
    };
    intents.push(...marketFallback(leftover, terminalCapacityPct, market?.orders ?? {}, myOrders, bestBuyOrder));
  }

  return intents;
}
