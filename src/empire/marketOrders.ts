// gh #60: live order-book scan, distilling Game.market.getAllOrders() into the best current buy/sell
// price per BOOST_TARGETS resource — see docs/market-plan.md decision 4. Read-only, same
// "live-game read written near where it's read" shape as empire/market.ts's own getHistory() scan;
// marketFallback.ts is the only consumer of the cache this writes. Compiled out of every build but
// push-main (decision 10) — trading against a local pserver's market is meaningless activity.

import { BOOST_TARGETS } from "./boostTargets";
import type { MarketStats } from "../memory/schema";

declare const __SERVER__: string;
const MARKET_TRADING_ENABLED = __SERVER__ === "main";

// New tier-3 SYSTEMS interval (decision 4): the order book is the most volatile part of market data
// (other players' live orders change constantly), so it needs to refresh far more often than the
// MARKET_SCAN_INTERVAL-gated price-history scan, despite getAllOrders() being the pricier call.
export const ORDER_SCAN_INTERVAL = 50;

/** Reduces a live order list to the best (lowest) sell price and best (highest) buy price per
 * BOOST_TARGETS resource — orders for any other resource are ignored (decision 1). A resource with no
 * orders of one type simply has that side omitted, not zeroed.
 *
 * `ownOrderIds` excludes our own standing orders from the reduction — without this, a colony's own
 * previously-placed buy/sell order can itself become "the best live price," so the empire ends up pricing
 * against its own bids instead of a real competitor's, and multiple colonies bidding on the same resource
 * converge on copying whichever of our own orders happens to be highest/lowest that pass (confirmed live:
 * every owned colony's standing buy order for a given resource had settled on the exact same price).
 * Matches Overmind's TraderJoe.buildMarketCache: `Game.market.orders` is inherently our-orders-only, so
 * its id set is the authoritative exclusion list — more direct than inferring "ours" from `roomName`
 * ownership, and correct even for an order whose room state has since changed. */
export function summarizeOrders(orders: readonly Order[], ownOrderIds: ReadonlySet<string>): MarketStats["orders"] {
  const out: MarketStats["orders"] = {};
  for (const order of orders) {
    if (ownOrderIds.has(order.id)) continue;
    const resource = order.resourceType as ResourceConstant;
    if (BOOST_TARGETS[resource] === undefined) continue;
    const existing = out[resource] ?? {};
    if (order.type === ORDER_SELL && (existing.sellMin === undefined || order.price < existing.sellMin)) {
      existing.sellMin = order.price;
    }
    if (order.type === ORDER_BUY && (existing.buyMax === undefined || order.price > existing.buyMax)) {
      existing.buyMax = order.price;
    }
    out[resource] = existing;
  }
  return out;
}

export function scanOrdersNow(): MarketStats["orders"] {
  const ownOrderIds = new Set(Object.keys(Game.market.orders));
  return summarizeOrders(
    Game.market.getAllOrders(o => BOOST_TARGETS[o.resourceType as ResourceConstant] !== undefined),
    ownOrderIds
  );
}

/** Tier-3 entry point: refreshes MarketStats.orders in place. No-ops entirely (dead-code-eliminated,
 * per decision 10) outside the real World build — never runs against a local pserver's market. */
export function runOrderScan(): void {
  if (!MARKET_TRADING_ENABLED) return;
  const mem = (Memory.stats.market ??= { tick: 0, prices: {}, orders: {} });
  mem.orders = scanOrdersNow();
  mem.tick = Game.time;
}
