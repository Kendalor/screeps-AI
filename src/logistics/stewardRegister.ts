// Steward's self-registration (gh #51, ADR 0008's "Steward gets its own rate-ranked pool, same shape as
// Transport's" decision): the anchor link/storage/terminal triangle stewardBehavior.ts manages today via
// hand-tuned fixed thresholds (LINK_DRAIN_FLOOR, STORAGE_SURPLUS_FRACTION, TERMINAL_LOW_FRACTION,
// CONTROLLER_LINK_LOW_FRACTION — see that file), expressed instead as real signed LogisticsRequests so the
// legs compete under logistics/greedyMatch.ts's pickBestPair (gh #59 — the same greedy cross-resource
// pairing algorithm Transport's pool uses), rather than three independent if-checks run in a fixed order.
// This module builds the requests only — selection reuses pickBestPair directly (see
// behaviors/stewardTaskRunner.ts), no reimplementation of it.
//
// Self-registration reads live Game.* state directly, same as register.ts/supplyRegister.ts (ADR 0008's
// scoped departure from ColonySnapshot for src/logistics/ only). links.ts's own hardwired, unconditional,
// instant link-firing legs (source->anchor, anchor->controller) are untouched by this module — there is no
// creep trip on those legs for a rate to apply to (see links.ts's header).
//
// Threshold values were originally carried over VERBATIM from stewardBehavior.ts's hand-tuned constants
// (same reasoning documented there) — gh #51 replaced the shape of the decision (three independent checks
// -> three ranked requests), not the numbers themselves. gh #59 later changed the numbers for ONE of the
// three (terminal energy: TERMINAL_LOW_FRACTION's flat-percent-of-capacity threshold became the flat
// absolute TERMINAL_ENERGY_TARGET/TERMINAL_ENERGY_LOW pair below — see registerTerminalRebalanceRequest's
// own doc) while leaving link-drain/controller-link-top-up untouched.
//
// Post-cutover fix: registerControllerLinkTopUpRequest originally built its request against the
// CONTROLLER link directly, sending a live Steward creep on a real multi-tile trip out to the controller
// (confirmed live on the pserver) — stewardBehavior.ts only ever used the controller link's fullness as a
// TRIGGER, never as somewhere it travelled to; the actual delivery target was always the anchor link (see
// registerControllerLinkTopUpRequest's own doc). Fixed to take both links and target the anchor one.

import { requestInput, requestOutput, type LogisticsRequest } from "./request";
import { baseTargetFor, boostLineResources } from "../empire/boostTargets";

// A link should never sit full — it needs headroom for the next source delivery — so drain it toward
// storage the instant it holds anything at all, no fractional floor needed on this leg. Mirrors
// stewardBehavior.ts's LINK_DRAIN_FLOOR exactly.
export const LINK_DRAIN_FLOOR = 0;
// Storage is treated as "has plenty to spare" only once comfortably above the point Logistics itself would
// start drawing it down to cover a spawn deficit. Originally 50% (mirroring stewardBehavior.ts's
// STORAGE_SURPLUS_FRACTION exactly); lowered to 10% (100,000 of the 1,000,000 storage capacity) so the
// terminal starts getting topped up toward TERMINAL_ENERGY_TARGET much sooner — 50% was leaving the
// terminal starved of energy (and unable to pay send fees) until storage had accumulated an unrealistically
// large buffer.
export const STORAGE_SURPLUS_FRACTION = 0.1;
// gh #59 decision 7's energy side: a FLAT absolute target, not a percentage of terminal capacity (300,000)
// — the design's own reasoning: "the one number among all three [reference] bots' balance logic that's
// actually well-reasoned" (Overmind's own `equilibrium`). Deliberately independent of the empire-owned
// BOOST_TARGETS system below — energy has no empire-assigned target to be relative to, and a terminal
// needs energy on hand to pay a send's fee immediately, not once some other resource's target happens to
// be configured. This is colony-local Steward policy, plain and simple, same as LINK_DRAIN_FLOOR above.
export const TERMINAL_ENERGY_TARGET = 50_000;
export const TERMINAL_ENERGY_LOW = 40_000;
// gh #59 decision 7's two-basis rule, non-energy side: every resource OTHER than energy has no meaningful
// "percent of structure capacity" — a 3,000-unit boost target is a rounding error against a 300,000-unit
// terminal. Storage's surplus threshold is a multiplier on that resource's OWN assigned target
// (BOOST_TARGETS) — storage should hold the real target stock per decision 10; only genuine surplus above
// that belongs in the terminal at all. No separate terminal-low fraction exists here (unlike energy's
// TERMINAL_ENERGY_LOW) — see registerTerminalRebalanceRequest's own doc for why a percent-of-target
// terminal floor was tried and dropped as unworkable at this target's scale.
export const RESOURCE_STORAGE_SURPLUS_MULTIPLIER = 1.0;
// Below this, the controller link is "running low enough to bother." Mirrors stewardBehavior.ts's
// CONTROLLER_LINK_LOW_FRACTION exactly.
export const CONTROLLER_LINK_LOW_FRACTION = 0.5;

/**
 * The anchor link's energy, if it holds enough to be worth draining (LINK_DRAIN_FLOOR) — a MATCHED PAIR
 * (the link HAS energy to give up; storage, up to the same amount, WANTS it — the only place a drained
 * link's energy has ever gone, see stewardBehavior.ts's own drain leg).
 *
 * Returns BOTH sides directly (gh #59: greedyMatch.ts's pickBestPair requires a genuine opposite-signed
 * counterpart to exist before pairing at all) rather than relying on a separate, generic "storage always
 * offers energy" pool entry — found live during testing: a shared/unconditional storage energy request
 * sized independently of THIS specific leg could still outscore and displace the link's own (correct,
 * smaller) amount for pickBestPair's "best output" slot purely by raw magnitude, then fail to pair at all
 * once its own opposite-signed twin got excluded as a same-target detour (storage matching itself) —
 * silently breaking link drain entirely even though a valid link<->storage pair existed in the pool. Storage
 * is capacity-unconstrained for energy in practice (never the reason this leg wouldn't fire), so its output
 * side here is simply capped at the link's own drain amount — never larger, so it can never win the "best
 * output" slot away from the link's own request when both exist (they're the same request pair, not two
 * independent candidates racing each other).
 */
export function registerLinkDrainRequest(
  link: StructureLink | undefined,
  storage: StructureStorage | undefined
): { output: LogisticsRequest; input: LogisticsRequest } | undefined {
  if (!link || !storage) return undefined;
  const stored = link.store.getUsedCapacity(RESOURCE_ENERGY);
  if (stored <= LINK_DRAIN_FLOOR) return undefined;
  return { output: requestOutput(link, RESOURCE_ENERGY, stored), input: requestInput(storage, RESOURCE_ENERGY, stored) };
}

/**
 * The ANCHOR link's remaining want, triggered once the CONTROLLER link has run low
 * (CONTROLLER_LINK_LOW_FRACTION) AND storage actually has energy to give — a MATCHED PAIR (the anchor link
 * WANTS energy delivered; storage, up to the same amount, HAS it to give). Mirrors stewardBehavior.ts's
 * controllerLinkNeedsTopUp gate exactly, including its target: the controller link's own fullness is only
 * the TRIGGER, never the delivery target — "the steward itself never goes near the controller link, which
 * sits out of its reach at the controller, not the anchor" (stewardBehavior.ts's own comment on this leg).
 * Before RCL7 (no source links yet) nothing else ever puts energy into the link chain at all; links.ts's own
 * anchor->controller leg carries it the rest of the way once it lands in the anchor link (see that file's
 * header) — a real bug shipped here once (gh #51/#54): registering this request against `controllerLink`
 * directly sent a creep on a real multi-tile trip to the controller link, something Steward must never do.
 *
 * Returns BOTH sides directly, same reasoning as registerLinkDrainRequest's own doc — storage's output side
 * is capped at exactly `wanted` (the link's own free capacity), never larger, so it can't win the "best
 * output" slot away from a genuinely bigger request elsewhere (e.g. terminal rebalance) nor fail to pair
 * with its own twin.
 */
export function registerControllerLinkTopUpRequest(
  link: StructureLink | undefined,
  controllerLink: StructureLink | undefined,
  storage: StructureStorage | undefined
): { input: LogisticsRequest; output: LogisticsRequest } | undefined {
  if (!link || !controllerLink || !storage) return undefined;
  const storageHas = storage.store.getUsedCapacity(RESOURCE_ENERGY);
  if (storageHas <= 0) return undefined;
  const capacity = controllerLink.store.getCapacity(RESOURCE_ENERGY);
  const used = controllerLink.store.getUsedCapacity(RESOURCE_ENERGY);
  if (used >= capacity * CONTROLLER_LINK_LOW_FRACTION) return undefined;
  const wanted = Math.min(link.store.getFreeCapacity(RESOURCE_ENERGY), storageHas);
  if (wanted <= 0) return undefined;
  return { input: requestInput(link, RESOURCE_ENERGY, wanted), output: requestOutput(storage, RESOURCE_ENERGY, wanted) };
}

/**
 * The terminal's remaining energy want, once storage has a genuine surplus AND the terminal itself is
 * below TERMINAL_ENERGY_LOW — a MATCHED PAIR (the terminal WANTS energy delivered; storage, up to the same
 * amount, HAS it to give). A FLAT absolute target (TERMINAL_ENERGY_TARGET/TERMINAL_ENERGY_LOW),
 * colony-local Steward policy, independent of the empire-owned BOOST_TARGETS system entirely — energy has
 * no empire-assigned target to be relative to, and terminal energy specifically can't wait for a
 * storage-surplus fraction if it doesn't already sit at a usable floor, since it's needed immediately to
 * pay any send's fee. Requires BOTH conditions together (mirrors stewardBehavior.ts's original
 * storage->terminal rebalance gate exactly) so this can't oscillate against Logistics' own
 * storage-as-source/sink switch — unlike the mineral want/have pair below, this stays a single paired
 * function rather than two independent one-sided requests, since the two-condition gate is deliberately
 * part of energy's own design (see this function's git history for the reasoning). The want is capped at
 * TERMINAL_ENERGY_TARGET (not the terminal's full 300,000 capacity) — the whole point of a flat target is
 * that Steward stops filling the terminal with energy once it reaches that floor, not that it dumps all of
 * storage's surplus in.
 *
 * Returns BOTH sides as a real pair (gh #59: greedyMatch.ts's pickBestPair requires a genuine
 * opposite-signed counterpart to exist before pairing at all) — storage's OUTPUT here is capped at exactly
 * the same `wanted` amount, sized to THIS leg alone (same reasoning as registerLinkDrainRequest's own doc:
 * a shared, unconditional storage energy request independent of any one leg was tried and reverted, since
 * it could crowd out a smaller leg's own real amount for pickBestPair's "best output" slot). Each leg owns
 * its own scale.
 *
 * `empireReservedAmount` (gh #59 decision 6/user story 7): a matched empire transfer raises the computed
 * wanted amount to at least this much — `max(ordinaryWant, empireReservedAmount)` — so the terminal keeps
 * replenishing toward a pending send even once its own ordinary gate would otherwise stop asking, while
 * still competing for Steward's attention via the normal pickBestPair ranking rather than bypassing it.
 * Ignored (no floor) when omitted/0 — the ordinary rebalance behavior is untouched by default.
 */
export function registerTerminalEnergyRebalanceRequest(
  storage: StructureStorage | undefined,
  terminal: StructureTerminal | undefined,
  empireReservedAmount = 0
): { input: LogisticsRequest; output: LogisticsRequest } | undefined {
  if (!storage || !terminal) return undefined;
  const storageSurplus = storage.store.getUsedCapacity(RESOURCE_ENERGY) > storage.store.getCapacity(RESOURCE_ENERGY) * STORAGE_SURPLUS_FRACTION;
  if (!storageSurplus) return undefined;
  const terminalUsed = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
  if (terminalUsed >= TERMINAL_ENERGY_LOW) return undefined;
  const towardTarget = Math.min(TERMINAL_ENERGY_TARGET - terminalUsed, terminal.store.getFreeCapacity(RESOURCE_ENERGY));
  const wanted = Math.max(towardTarget, empireReservedAmount);
  if (wanted <= 0) return undefined;
  const available = Math.min(wanted, storage.store.getUsedCapacity(RESOURCE_ENERGY));
  if (available <= 0) return undefined;
  return { input: requestInput(terminal, RESOURCE_ENERGY, wanted), output: requestOutput(storage, RESOURCE_ENERGY, available) };
}

/**
 * Storage's want for `resource` (a BOOST_TARGETS mineral/compound, never energy — see
 * registerTerminalEnergyRebalanceRequest for that), whenever storage sits below its own target — an input
 * request (storage WANTS `resource` delivered). Unconditional on the terminal's own state: this is one
 * independent, one-sided half of the mineral want/have pair (the other half is
 * registerMineralTerminalHaveRequest below) — both land in the SAME flat pool (registerStewardRequests) and
 * are paired by greedyMatch.ts's pickBestPair, the same way registerLinkDrainRequest's output request and
 * registerControllerLinkTopUpRequest's input request already coexist on the anchor link without either
 * function checking the other's threshold internally. Deliberately NOT gated on "does the terminal
 * currently have any to give" — pickBestPair already requires a real opposite-signed counterpart to exist
 * before pairing at all (see that module's own doc); a storage want with nothing to fill it is simply never
 * picked, same as any other unfillable request in the pool.
 */
export function registerMineralStorageWantRequest(storage: StructureStorage | undefined, resource: ResourceConstant): LogisticsRequest | undefined {
  if (!storage) return undefined;
  const target = baseTargetFor(resource);
  if (target == null) return undefined; // no assigned target — nothing to rebalance this resource toward
  const storageUsed = storage.store.getUsedCapacity(resource);
  const towardTarget = Math.min(target - storageUsed, storage.store.getFreeCapacity(resource));
  if (towardTarget <= 0) return undefined;
  return requestInput(storage, resource, towardTarget);
}

/**
 * The terminal's `resource` stock, if any — an output request (the terminal HAS `resource` to give up),
 * the buffer-side half of the mineral want/have pair (see registerMineralStorageWantRequest's own doc for
 * how the two combine via the shared pool rather than a single paired function). `target` (BOOST_TARGETS)
 * is STORAGE's own number to hold, not the terminal's — the terminal has no standing allocation of its own
 * and is drained toward 0 (same floor as registerLinkDrainRequest's LINK_DRAIN_FLOOR), not toward `target`
 * a second time. Draining only down to `target` here was a bug: combined with
 * registerMineralStorageWantRequest also pulling storage up to that same `target`, the colony would settle
 * with `target` sitting in EACH of storage and terminal simultaneously (double the real target) instead of
 * `target` once, in storage, where it belongs.
 *
 * `empireReservedAmount` (gh #59 decision 6): a pending empire-matched transfer's amount is protected from
 * this drain — it's subtracted from the terminal's stock before computing what's still spare to give up, so
 * Steward's own local rebalance can't vacuum a mineral back into storage out from under a send the empire
 * layer already decided to make. Ignored (no protection) when omitted/0.
 */
export function registerMineralTerminalHaveRequest(
  terminal: StructureTerminal | undefined,
  resource: ResourceConstant,
  empireReservedAmount = 0
): LogisticsRequest | undefined {
  if (!terminal) return undefined;
  const target = baseTargetFor(resource);
  if (target == null) return undefined; // no assigned target — this resource isn't tracked at all
  const terminalUsed = terminal.store.getUsedCapacity(resource);
  const spare = terminalUsed - empireReservedAmount;
  if (spare <= 0) return undefined;
  return requestOutput(terminal, resource, spare);
}

/**
 * EXPERIMENTAL (gh #59 follow-up, not yet load-bearing): storage's surplus above `target *
 * RESOURCE_STORAGE_SURPLUS_MULTIPLIER`, if any — an output request (storage HAS more than its own surplus
 * threshold, the rest belongs in the terminal per decision 7). This is the leg that was designed
 * ("storage surplus threshold ≈ some factor above target", docs/empire-logistics-plan.md decision 7) but
 * never actually implemented — confirmed live: a mineral sitting at several times its target (e.g. H at
 * 24,688 vs a 3,000 target) never moved anywhere, since the pool only ever had a storage-WANT (fires only
 * below target) and a terminal-HAVE (drains terminal->storage), nothing offering storage's own overflow
 * outward. Registered here as storage's OUTPUT half; registerMineralStorageOverflowWantRequest below is
 * its INPUT counterpart (terminal side) so greedyMatch.ts's pickBestPair has a real pair to match, same
 * shape as every other leg in this file.
 */
export function registerMineralStorageSurplusRequest(storage: StructureStorage | undefined, resource: ResourceConstant): LogisticsRequest | undefined {
  if (!storage) return undefined;
  const target = baseTargetFor(resource);
  if (target == null) return undefined;
  const surplusThreshold = target * RESOURCE_STORAGE_SURPLUS_MULTIPLIER;
  const storageUsed = storage.store.getUsedCapacity(resource);
  const surplus = storageUsed - surplusThreshold;
  if (surplus <= 0) return undefined;
  return requestOutput(storage, resource, surplus);
}

/**
 * EXPERIMENTAL (gh #59 follow-up, not yet load-bearing): the terminal's remaining free capacity for
 * `resource` — an input request (the terminal can absorb storage's overflow, decision 7's "terminal holds
 * surplus-above-target plus a send-buffer"). Unconditional beyond "does the terminal exist and have room" —
 * same "no gate on the other side, pickBestPair only pairs what's actually fulfillable" reasoning as
 * registerMineralStorageWantRequest's own doc.
 */
export function registerMineralStorageOverflowWantRequest(terminal: StructureTerminal | undefined, resource: ResourceConstant): LogisticsRequest | undefined {
  if (!terminal) return undefined;
  const target = baseTargetFor(resource);
  if (target == null) return undefined;
  const free = terminal.store.getFreeCapacity(resource);
  if (free <= 0) return undefined;
  return requestInput(terminal, resource, free);
}

/**
 * Every live request in Steward's pool right now: link-drain, controller-link top-up, and energy's
 * terminal rebalance — each a MATCHED PAIR now (registerLinkDrainRequest/registerControllerLinkTopUpRequest/
 * registerTerminalEnergyRebalanceRequest each return both their own output and input side directly, see
 * registerLinkDrainRequest's own doc for why storage's counterpart is sized/scoped per-leg rather than a
 * single shared, unconditional "storage always offers energy" pool entry) — plus, per BOOST_TARGETS
 * resource, a mineral storage-want plus a mineral terminal-have (still two independent one-sided requests,
 * unlike energy's paired legs — see registerMineralStorageWantRequest's own doc for why). All land in ONE
 * flat pool so greedyMatch.ts's pickBestPair does the actual cross-resource race. `storage` is required for
 * every leg (mirrors stewardBehavior.ts, where every branch already guards on `storage` existing) — a
 * colony with no storage yet has nothing for Steward's pool to rank.
 *
 * `empireReservations`, keyed by resource, is gh #59 decision 6's injected protection/floor: for energy it
 * raises registerTerminalEnergyRebalanceRequest's wanted amount; for a mineral it protects that much of the
 * terminal's stock from registerMineralTerminalHaveRequest's drain (see that function's own doc). Omitted/
 * empty by default, so ordinary (non-empire-driven) rebalancing is unaffected.
 */
export function registerStewardRequests(
  link: StructureLink | undefined,
  controllerLink: StructureLink | undefined,
  storage: StructureStorage | undefined,
  terminal: StructureTerminal | undefined,
  empireReservations: Partial<Record<ResourceConstant, number>> = {}
): LogisticsRequest[] {
  const out: LogisticsRequest[] = [];
  const drain = registerLinkDrainRequest(link, storage);
  if (drain) out.push(drain.output, drain.input);
  const topUp = registerControllerLinkTopUpRequest(link, controllerLink, storage);
  if (topUp) out.push(topUp.input, topUp.output);

  const energyRebalance = registerTerminalEnergyRebalanceRequest(storage, terminal, empireReservations[RESOURCE_ENERGY] ?? 0);
  if (energyRebalance) out.push(energyRebalance.input, energyRebalance.output);

  for (const resource of boostLineResources()) {
    const storageWant = registerMineralStorageWantRequest(storage, resource);
    if (storageWant) out.push(storageWant);
    const terminalHave = registerMineralTerminalHaveRequest(terminal, resource, empireReservations[resource] ?? 0);
    if (terminalHave) out.push(terminalHave);

    // EXPERIMENTAL (see registerMineralStorageSurplusRequest's own doc) — storage overflow -> terminal.
    const storageSurplus = registerMineralStorageSurplusRequest(storage, resource);
    if (storageSurplus) out.push(storageSurplus);
    const overflowWant = registerMineralStorageOverflowWantRequest(terminal, resource);
    if (overflowWant) out.push(overflowWant);
  }
  return out;
}
