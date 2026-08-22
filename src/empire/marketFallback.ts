// gh #60: resolves whatever empire/logistics.ts's matchEmpireRequests couldn't pair colony-to-colony
// against the real market — see docs/market-plan.md decisions 3/6/7 for the full design rationale. Pure
// decision logic over injected data (no live Game.* reads inside marketFallback itself), same "inject a
// callback instead of reaching into Game.rooms" convention empire/logistics.ts's matchEmpireRequests
// already established for receiverFreeCapacity/sendCost. Compiled out of every build but push-main
// (decision 10) — trading against a local pserver's market is meaningless activity.

import type { EmpireRequest } from "./logistics";
import type { Intent } from "../intents/types";
import type { MarketStats } from "../memory/schema";

declare const __SERVER__: string;
export const MARKET_TRADING_ENABLED = __SERVER__ === "main";

// Per-resource terminal-fullness threshold above which a surplus force-sells immediately (ignoring the
// normal price floor) instead of maintaining a priced standing order — a jammed terminal blocks
// everything else the colony needs to receive (decision 6).
const FORCE_SELL_CAPACITY_PCT = 0.9;

// Guardrail band around the 7-day avgPrice: never buy more than 20% above it, never sell more than 20%
// below it. A live order-book price outside this band isn't traded at all this pass (not clamped to the
// band edge) — the empire only ever trades on its own terms, never chases a thin/manipulated order book.
// Does not apply to the force-sell escape hatch (sellPath's capacityPct branch), which is deliberately
// price-blind by design (decision 6) — a jammed terminal needs to clear regardless of price.
const GUARDRAIL_BAND = 0.2;

function withinBuyGuardrail(buyPrice: number, avgPrice: number | undefined): boolean {
  return avgPrice !== undefined && buyPrice <= avgPrice * (1 - GUARDRAIL_BAND);
}

function withinSellGuardrail(sellPrice: number, avgPrice: number | undefined): boolean {
  return avgPrice !== undefined && sellPrice >= avgPrice * (1 + GUARDRAIL_BAND);
}

/** The credit cost to buy a full BOOST_TARGETS quantity of every boost-line resource, at today's live
 * sell price (falling back to the slower-moving history average when no live sell price is cached yet) —
 * "how much would it cost, right now, to buy the entire standing stockpile target from scratch" (decision
 * 3). Derived from the flat, stock-independent target rather than the live shortfall specifically to avoid
 * circularity with the very leftover deficit this module exists to resolve. */
export function creditReserve(
  targets: Partial<Record<ResourceConstant, number>>,
  prices: MarketStats["prices"],
  orders: MarketStats["orders"]
): number {
  let total = 0;
  for (const resource of Object.keys(targets) as ResourceConstant[]) {
    const qty = targets[resource];
    if (qty == null) continue;
    const price = orders[resource]?.sellMin ?? (prices as Record<string, { avgPrice: number } | undefined>)[resource]?.avgPrice ?? 0;
    total += qty * price;
  }
  return total;
}

/** The minimal live-order surface this module reads for OUR OWN standing orders — satisfied by a real
 * Game.market.orders entry or a plain test stub. Only the fields the decision logic actually inspects. */
export interface LiveOrder {
  id: string;
  type: "buy" | "sell";
  resourceType: ResourceConstant;
  roomName?: string;
  remainingAmount: number;
  price: number;
}

const ORDER_AMOUNT = 3000; // flat per-order size; no partial-fill sizing in this MVP slice

/**
 * Buy/sell/reprice/prune decision logic (decisions 6/7): for every leftover deficit/surplus, maintains
 * at most one buy and one sell standing order per resource per colony — repriced/extended in place, never
 * cancelled-and-recreated, and pruned once no longer needed.
 *
 * `terminalCapacityPct`, `myOrders`, and `bestBuyOrder` are all injected (same pattern
 * matchEmpireRequests already uses for receiverFreeCapacity/sendCost) so this stays a pure function over
 * plain stubs, no live Game.* lookup inside.
 * - `myOrders`: OUR OWN live standing orders (Game.market.orders) — what reprice/extend/prune act on.
 * - `bestBuyOrder`: the best (highest-price) live buy order ANY player currently has for a resource —
 *   distinct from `myOrders`/`orders[resource].buyMax`, since force-selling needs a real dealable order id
 *   belonging to whoever's actually offering to buy, not our own cached summary price.
 */
export function marketFallback(
  leftover: readonly EmpireRequest[],
  terminalCapacityPct: (colony: string, resource: ResourceConstant) => number,
  orders: MarketStats["orders"],
  prices: MarketStats["prices"],
  myOrders: readonly LiveOrder[],
  bestBuyOrder: (resource: ResourceConstant) => { id: string; price: number } | undefined
): Intent[] {
  const intents: Intent[] = [];

  // Index our own existing standing orders by colony+resource+direction, so each leftover entry can look
  // up its own order (if any) in O(1) rather than rescanning myOrders per entry.
  const byKey = new Map<string, LiveOrder>();
  for (const o of myOrders) {
    if (!o.roomName) continue;
    byKey.set(`${o.roomName}:${o.resourceType}:${o.type}`, o);
  }
  const wanted = new Set<string>();

  for (const entry of leftover) {
    const { colony, resource, amount } = entry;
    if (amount === 0) continue;
    const avgPrice = (prices as Record<string, { avgPrice: number } | undefined>)[resource]?.avgPrice;

    if (amount < 0) {
      const capacityPct = terminalCapacityPct(colony, resource);
      // The force-sell branch is price-blind by design (decision 6) — always "wanted" regardless of the
      // guardrail. The normal priced branch only counts as wanted (kept alive, not pruned) when the live
      // sellMin actually clears the guardrail this pass.
      if (capacityPct >= FORCE_SELL_CAPACITY_PCT || withinSellGuardrail(orders[resource]?.sellMin ?? -Infinity, avgPrice)) {
        wanted.add(`${colony}:${resource}:sell`);
      }
      sellPath(colony, resource, capacityPct, orders, avgPrice, byKey, bestBuyOrder, intents);
    } else {
      if (withinBuyGuardrail(orders[resource]?.buyMax ?? Infinity, avgPrice)) {
        wanted.add(`${colony}:${resource}:buy`);
      }
      buyPath(colony, resource, orders, avgPrice, byKey, intents);
    }
  }

  // Prune (decision 6, point 3): a standing order this module previously placed, whose colony+resource+
  // direction no longer appears in this pass's leftover at all, gets cancelled — an inert unwanted order
  // can still transact at a stale price.
  for (const [key, order] of byKey) {
    if (wanted.has(key)) continue;
    intents.push({ kind: "marketCancelOrder", order: order.id });
  }

  return intents;
}

function sellPath(
  colony: string,
  resource: ResourceConstant,
  capacityPct: number,
  orders: MarketStats["orders"],
  avgPrice: number | undefined,
  byKey: Map<string, LiveOrder>,
  bestBuyOrder: (resource: ResourceConstant) => { id: string; price: number } | undefined,
  intents: Intent[]
): void {
  const key = `${colony}:${resource}:sell`;
  const existing = byKey.get(key);

  if (capacityPct >= FORCE_SELL_CAPACITY_PCT) {
    // Force-sell: dump into the best current live buy order (any player's) immediately, ignoring price —
    // a jammed terminal blocks everything else the colony needs to receive (decision 6). Deliberately NOT
    // guardrailed: a jammed terminal must clear regardless of price, that's the whole point of this branch.
    // No real buy order to deal against yet this pass simply means nothing force-sells this tick.
    const buy = bestBuyOrder(resource);
    if (buy) intents.push({ kind: "marketDeal", order: buy.id, amount: ORDER_AMOUNT, room: colony });
    return;
  }

  const sellPrice = orders[resource]?.sellMin;
  if (sellPrice === undefined) return;
  // Guardrail: never sell more than 20% below the 7-day average — a live sellMin below that band is
  // rejected outright this pass (not clamped up to the band edge), same as if no price were cached at all.
  if (!withinSellGuardrail(sellPrice, avgPrice)) return;
  if (existing) {
    intents.push({ kind: "marketReprice", order: existing.id, price: sellPrice });
    if (existing.remainingAmount < ORDER_AMOUNT) {
      intents.push({ kind: "marketExtendOrder", order: existing.id, amount: ORDER_AMOUNT - existing.remainingAmount });
    }
  } else {
    intents.push({ kind: "marketCreateOrder", room: colony, resource, amount: ORDER_AMOUNT, price: sellPrice, type: "sell" });
  }
}

function buyPath(
  colony: string,
  resource: ResourceConstant,
  orders: MarketStats["orders"],
  avgPrice: number | undefined,
  byKey: Map<string, LiveOrder>,
  intents: Intent[]
): void {
  // Not gated on the credit reserve (decision 6) — the reserve is scoped for future non-boost-line
  // convenience spend, not this design's own boost-line buying.
  const buyPrice = orders[resource]?.buyMax;
  if (buyPrice === undefined) return;
  // Guardrail: never buy more than 20% above the 7-day average — a live buyMax above that band is
  // rejected outright this pass (not clamped down to the band edge), same as if no price were cached.
  if (!withinBuyGuardrail(buyPrice, avgPrice)) return;
  const key = `${colony}:${resource}:buy`;
  const existing = byKey.get(key);
  if (existing) {
    intents.push({ kind: "marketReprice", order: existing.id, price: buyPrice });
    if (existing.remainingAmount < ORDER_AMOUNT) {
      intents.push({ kind: "marketExtendOrder", order: existing.id, amount: ORDER_AMOUNT - existing.remainingAmount });
    }
  } else {
    intents.push({ kind: "marketCreateOrder", room: colony, resource, amount: ORDER_AMOUNT, price: buyPrice, type: "buy" });
  }
}
