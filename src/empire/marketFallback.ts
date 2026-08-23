// gh #60: resolves whatever empire/logistics.ts's matchEmpireRequests couldn't pair colony-to-colony
// against the real market — see docs/market-plan.md decisions 3/6/7 for the full design rationale. Pure
// decision logic over injected data (no live Game.* reads inside marketFallback itself), same "inject a
// callback instead of reaching into Game.rooms" convention empire/logistics.ts's matchEmpireRequests
// already established for receiverFreeCapacity/sendCost. Compiled out of every build but push-main
// (decision 10) — trading against a local pserver's market is meaningless activity.

import type { EmpireRequest } from "./logistics";
import type { Intent } from "../intents/types";
import type { MarketStats } from "../memory/schema";
import { LIQUIDATION_MODE } from "./boostTargets";

declare const __SERVER__: string;
export const MARKET_TRADING_ENABLED = __SERVER__ === "main";

// Emergency kill switch for the buy side only (selling/force-selling is unaffected — a jammed terminal
// still needs to clear regardless of buying policy). Flip to false and redeploy to immediately stop ALL
// compound buying: no new standing buy orders, no reprice/extend of existing ones, no good-deal immediate
// deal()s — and every standing buy order this account currently has open gets cancelled outright the very
// next pass, regardless of whether its leftover entry still looks "wanted". Added after a live incident
// where unbounded buying (pre-dating the wantedAmount sizing fix) burned through the account's entire
// credit balance — this is a manual, hand-edited stop, deliberately NOT a runtime Memory flag (nothing in
// this file should be able to silently re-enable spending on its own). Exported only so
// runEmpireLogisticsPass can pass it through explicitly rather than marketFallback reading the module
// constant directly — keeps this function callable with an override in tests.
export const BUYING_ACTIVATED = false;

// LIQUIDATION_MODE itself now lives in boostTargets.ts (re-exported here for existing importers) since it
// primarily controls baseTargetFor/BOOST_TARGETS — collapsing every configured resource's target to 0 is
// what actually reclassifies a colony's full stock as "surplus" for both Steward and
// runEmpireLogisticsPass's computeEmpireRequests, not anything in this file. See boostTargets.ts's own doc
// for the full mechanism. What THIS file does while it's on: buyPath naturally never fires for these
// resources (a target of 0 can never produce a positive deficit, so BUYING_ACTIVATED needs no separate
// override here), and sellPath (below) additionally (1) ignores SELL_CAPACITY_PCT entirely — waiting for a
// terminal to fill up defeats the point of a deliberate liquidation — and (2) swaps the normal ±20%
// avgPrice guardrail for a looser, liquidation-specific floor (see withinLiquidationSellGuardrail) so a
// large stockpile actually clears instead of sitting just as gated as it would in normal operation.
export { LIQUIDATION_MODE };

// Per-resource terminal-fullness threshold above which a surplus force-sells immediately (ignoring the
// normal price floor) instead of maintaining a priced standing order — a jammed terminal blocks
// everything else the colony needs to receive (decision 6).
const FORCE_SELL_CAPACITY_PCT = 0.9;

// Per-resource terminal-fullness threshold BELOW which a surplus doesn't sell at all, even at a great
// price — the empire holds onto boost-line surplus rather than trading it away just because leftover has
// a negative entry for it. Only once a resource is genuinely eating a large share of the terminal's own
// capacity (a resource occupying X% of a terminal's TOTAL capacity is what terminalCapacityPct actually
// measures — see its own doc) does the normal priced sell path kick in; short of that, but at/above
// FORCE_SELL_CAPACITY_PCT, the price-blind escape hatch still applies regardless of this floor.
const SELL_CAPACITY_PCT = 0.8;

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

// LIQUIDATION_MODE's own, looser sell floor — replaces (not layers on top of) withinSellGuardrail while
// active: sell at the average price or up to one standard deviation below it, rather than requiring 20%
// ABOVE average. A missing stddevPrice (no cached history-derived spread yet) falls back to requiring
// exactly avgPrice or better — never a price floor of 0, which zero/undefined would otherwise produce.
function withinLiquidationSellGuardrail(sellPrice: number, avgPrice: number | undefined, stddevPrice: number | undefined): boolean {
  if (avgPrice === undefined) return false;
  return sellPrice >= avgPrice - (stddevPrice ?? 0);
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

// Ceiling on any single trade/standing-order size — a backstop against a corrupted or absurd leftover
// value, not the normal sizing mechanism (see `wantedAmount` below for that). Real per-trade sizing is
// always min(this, abs(leftover.amount)): sizing off the flat ceiling alone (the old behavior) meant a
// small remaining deficit/surplus (e.g. 500 left to fill) still traded a full 3000 — overshooting straight
// past the target into the opposite direction — and, more subtly, once an outstanding order DID fully
// fill, the next pass's fresh deficit recompute could still be a non-multiple of 3000 (e.g. colony-to-
// colony matching or a role-multiplier retarget changed the true remaining gap between passes), so the
// flat ceiling had no way to land exactly on it even across multiple fills.
const ORDER_AMOUNT_CEILING = 3000;

/** The real per-pass trade/order size for a leftover entry: never more than what's actually still needed,
 * and never more than the flat ceiling above. */
function wantedAmount(leftoverAmount: number): number {
  return Math.min(ORDER_AMOUNT_CEILING, Math.abs(leftoverAmount));
}

/**
 * Buy/sell/reprice/prune decision logic (decisions 6/7): for every leftover deficit/surplus, maintains
 * at most one buy and one sell standing order per resource per colony — repriced/extended in place, never
 * cancelled-and-recreated, and pruned once no longer needed.
 *
 * `terminalCapacityPct`, `myOrders`, `bestBuyOrder`, and `bestSellOrder` are all injected (same pattern
 * matchEmpireRequests already uses for receiverFreeCapacity/sendCost) so this stays a pure function over
 * plain stubs, no live Game.* lookup inside.
 * - `myOrders`: OUR OWN live standing orders (Game.market.orders) — what reprice/extend/prune act on.
 * - `bestBuyOrder`: the best (highest-price) live buy order ANY player currently has for a resource —
 *   distinct from `myOrders`/`orders[resource].buyMax`, since force-selling needs a real dealable order id
 *   belonging to whoever's actually offering to buy, not our own cached summary price.
 * - `bestSellOrder`: the best (lowest-price) live sell order ANY player currently has for a resource — the
 *   buy-side mirror of `bestBuyOrder`, used to immediately deal on a good-deal price instead of waiting on
 *   a standing buy order (see buyPath).
 */
export function marketFallback(
  leftover: readonly EmpireRequest[],
  terminalCapacityPct: (colony: string, resource: ResourceConstant) => number,
  orders: MarketStats["orders"],
  prices: MarketStats["prices"],
  myOrders: readonly LiveOrder[],
  bestBuyOrder: (resource: ResourceConstant) => { id: string; price: number } | undefined,
  bestSellOrder: (resource: ResourceConstant) => { id: string; price: number; remainingAmount: number } | undefined,
  buyingActivated: boolean = BUYING_ACTIVATED,
  liquidationMode: boolean = LIQUIDATION_MODE
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
    const priceInfo = (prices as Record<string, { avgPrice: number; stddevPrice: number } | undefined>)[resource];
    const avgPrice = priceInfo?.avgPrice;

    if (amount < 0) {
      const capacityPct = terminalCapacityPct(colony, resource);
      const sellMin = orders[resource]?.sellMin;
      // Liquidation mode swaps in a looser sell floor (avgPrice - 1 stddev, not +20%) and ignores
      // SELL_CAPACITY_PCT entirely — see LIQUIDATION_MODE's own doc for why. The force-sell branch is
      // price-blind by design either way (decision 6) — always "wanted" regardless of any guardrail.
      const priceClears = liquidationMode
        ? withinLiquidationSellGuardrail(sellMin ?? -Infinity, avgPrice, priceInfo?.stddevPrice)
        : withinSellGuardrail(sellMin ?? -Infinity, avgPrice);
      if (capacityPct >= FORCE_SELL_CAPACITY_PCT || ((liquidationMode || capacityPct >= SELL_CAPACITY_PCT) && priceClears)) {
        wanted.add(`${colony}:${resource}:sell`);
      }
      sellPath(colony, resource, wantedAmount(amount), capacityPct, orders, avgPrice, priceInfo?.stddevPrice, byKey, bestBuyOrder, intents, liquidationMode);
    } else if (buyingActivated) {
      // A good-deal immediate buy (below) is a one-shot deal(), not a standing order — it deliberately
      // does NOT mark "wanted", so any standing buy order left over from a previous pass gets pruned
      // below instead of sitting there duplicating what the deal already bought.
      const dealt = buyPath(colony, resource, wantedAmount(amount), orders, avgPrice, byKey, bestSellOrder, intents);
      if (!dealt && withinBuyGuardrail(orders[resource]?.buyMax ?? Infinity, avgPrice)) {
        wanted.add(`${colony}:${resource}:buy`);
      }
    }
    // else: buying is switched off (BUYING_ACTIVATED=false) — this leftover entry contributes nothing;
    // `wanted` is never marked for the buy side, so any standing buy order this colony+resource already
    // has gets picked up by the prune pass below and cancelled, same as if the deficit no longer existed.
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
  wanted: number,
  capacityPct: number,
  orders: MarketStats["orders"],
  avgPrice: number | undefined,
  stddevPrice: number | undefined,
  byKey: Map<string, LiveOrder>,
  bestBuyOrder: (resource: ResourceConstant) => { id: string; price: number } | undefined,
  intents: Intent[],
  liquidationMode: boolean
): void {
  const key = `${colony}:${resource}:sell`;
  const existing = byKey.get(key);

  if (capacityPct >= FORCE_SELL_CAPACITY_PCT) {
    // Force-sell: dump into the best current live buy order (any player's) immediately, ignoring price —
    // a jammed terminal blocks everything else the colony needs to receive (decision 6). Deliberately NOT
    // guardrailed: a jammed terminal must clear regardless of price, that's the whole point of this branch.
    // No real buy order to deal against yet this pass simply means nothing force-sells this tick.
    const buy = bestBuyOrder(resource);
    if (buy) intents.push({ kind: "marketDeal", order: buy.id, amount: wanted, room: colony });
    return;
  }

  // Below SELL_CAPACITY_PCT, a surplus doesn't sell at all — having a leftover deficit-negative entry
  // (an empire-wide surplus over BOOST_TARGETS) isn't by itself a reason to trade; only a terminal that's
  // genuinely filling up with this resource is. Falling through to nothing here also means an existing
  // standing order gets pruned once capacity drops back below this floor (see marketFallback's `wanted`).
  // Liquidation mode ignores this floor entirely — see LIQUIDATION_MODE's own doc for why.
  if (!liquidationMode && capacityPct < SELL_CAPACITY_PCT) return;

  const sellPrice = orders[resource]?.sellMin;
  if (sellPrice === undefined) return;
  // Guardrail: normally never sell more than 20% below the 7-day average; liquidation mode swaps in the
  // looser avgPrice-1stddev floor instead (see withinLiquidationSellGuardrail). Either way, a live
  // sellMin below the active floor is rejected outright this pass (not clamped up to the edge), same as
  // if no price were cached at all.
  const priceClears = liquidationMode
    ? withinLiquidationSellGuardrail(sellPrice, avgPrice, stddevPrice)
    : withinSellGuardrail(sellPrice, avgPrice);
  if (!priceClears) return;
  if (existing) {
    intents.push({ kind: "marketReprice", order: existing.id, price: sellPrice });
    // Only ever tops up toward the CURRENT real surplus — a shrunk surplus that's already below
    // remainingAmount is left alone (extendOrder can only add, never remove; the order naturally shrinks
    // as it fills, or gets pruned outright once the surplus is fully gone).
    if (existing.remainingAmount < wanted) {
      intents.push({ kind: "marketExtendOrder", order: existing.id, amount: wanted - existing.remainingAmount });
    }
  } else {
    intents.push({ kind: "marketCreateOrder", room: colony, resource, amount: wanted, price: sellPrice, type: "sell" });
  }
}

/** Returns true when a good-deal immediate deal() was emitted this pass (see marketFallback's `dealt`
 * handling above) — false means the standing-buy-order path ran instead (or nothing at all). */
function buyPath(
  colony: string,
  resource: ResourceConstant,
  wanted: number,
  orders: MarketStats["orders"],
  avgPrice: number | undefined,
  byKey: Map<string, LiveOrder>,
  bestSellOrder: (resource: ResourceConstant) => { id: string; price: number; remainingAmount: number } | undefined,
  intents: Intent[]
): boolean {
  // Good-deal immediate buy: a live sell order at or below the 7-day average is worth taking right now
  // rather than waiting on a standing buy order to maybe get filled — "immediately buy if it's a good
  // deal (close to average price or below)". Checked BEFORE the guardrail/standing-order path below, and
  // skipped entirely with no cached avgPrice (no reference price means no "good deal" judgement possible).
  if (avgPrice !== undefined) {
    const sell = bestSellOrder(resource);
    if (sell && sell.price <= avgPrice) {
      intents.push({ kind: "marketDeal", order: sell.id, amount: Math.min(wanted, sell.remainingAmount), room: colony });
      return true;
    }
  }

  // Not gated on the credit reserve (decision 6) — the reserve is scoped for future non-boost-line
  // convenience spend, not this design's own boost-line buying.
  const buyPrice = orders[resource]?.buyMax;
  if (buyPrice === undefined) return false;
  // Guardrail: never buy more than 20% above the 7-day average — a live buyMax above that band is
  // rejected outright this pass (not clamped down to the band edge), same as if no price were cached.
  if (!withinBuyGuardrail(buyPrice, avgPrice)) return false;
  const key = `${colony}:${resource}:buy`;
  const existing = byKey.get(key);
  if (existing) {
    intents.push({ kind: "marketReprice", order: existing.id, price: buyPrice });
    // Only ever tops up toward the CURRENT real deficit — a shrunk deficit that's already below
    // remainingAmount is left alone (extendOrder can only add, never remove; the order naturally shrinks
    // as it fills, or gets pruned outright once the deficit is fully gone).
    if (existing.remainingAmount < wanted) {
      intents.push({ kind: "marketExtendOrder", order: existing.id, amount: wanted - existing.remainingAmount });
    }
  } else {
    intents.push({ kind: "marketCreateOrder", room: colony, resource, amount: wanted, price: buyPrice, type: "buy" });
  }
  return false;
}
