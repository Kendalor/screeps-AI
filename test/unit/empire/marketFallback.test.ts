// Unit-proves gh #60's marketFallback (empire/marketFallback.ts) — both the credit reserve calculation
// and the buy/sell/reprice/prune decision logic — as pure functions over plain fixture data. Same
// "inject the exact Game.* surface read" pattern empire/logistics.ts's own matchEmpireRequests tests
// already use (test/unit/empire/logistics.test.ts); no live Game.rooms/Game.market involved.

import { describe, expect, it } from "vitest";
import { creditReserve, marketFallback, type LiveOrder } from "../../../src/empire/marketFallback";
import type { EmpireRequest } from "../../../src/empire/logistics";
import type { MarketStats } from "../../../src/memory/schema";

function req(colony: string, resource: ResourceConstant, amount: number): EmpireRequest {
  return { colony, resource, amount, priority: "Normal" };
}

function order(overrides: Partial<LiveOrder>): LiveOrder {
  return {
    id: "order1",
    type: "sell",
    resourceType: RESOURCE_OXYGEN,
    roomName: "W1N1",
    remainingAmount: 3000,
    price: 1,
    ...overrides
  };
}

// avgPrice=10 for RESOURCE_OXYGEN everywhere below unless a test overrides it — the guardrail band is
// [8, 12] (±20%): buyMax must be <=8 to trade, sellMin must be >=12 to trade.
const avgPrices: MarketStats["prices"] = { O: { avgPrice: 10, stddevPrice: 0 } };

// ---------------------------------------------------------------------------
// creditReserve
// ---------------------------------------------------------------------------

describe("creditReserve", () => {
  it("sums correctly across every BOOST_TARGETS resource", () => {
    const targets = { H: 3000, O: 3000 } as Partial<Record<ResourceConstant, number>>;
    const prices: MarketStats["prices"] = {};
    const orders: MarketStats["orders"] = { H: { sellMin: 2 }, O: { sellMin: 3 } };

    expect(creditReserve(targets, prices, orders)).toBe(3000 * 2 + 3000 * 3);
  });

  it("prefers sellMin over avgPrice when both are present", () => {
    const targets = { H: 100 } as Partial<Record<ResourceConstant, number>>;
    const prices: MarketStats["prices"] = { H: { avgPrice: 10, stddevPrice: 0 } };
    const orders: MarketStats["orders"] = { H: { sellMin: 4 } };

    expect(creditReserve(targets, prices, orders)).toBe(400);
  });

  it("falls back to avgPrice when sellMin is missing for a resource", () => {
    const targets = { H: 100 } as Partial<Record<ResourceConstant, number>>;
    const prices: MarketStats["prices"] = { H: { avgPrice: 5, stddevPrice: 0 } };
    const orders: MarketStats["orders"] = {};

    expect(creditReserve(targets, prices, orders)).toBe(500);
  });

  it("contributes 0 for a resource missing from both caches", () => {
    const targets = { H: 100 } as Partial<Record<ResourceConstant, number>>;
    expect(creditReserve(targets, {}, {})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// marketFallback
// ---------------------------------------------------------------------------

const noCapacity = () => 0;
const noOrders: LiveOrder[] = [];
const noBestBuy = () => undefined;
const noBestSell = () => undefined;

describe("marketFallback", () => {
  it("emits a marketCreateOrder (buy) sized to the actual deficit for a colony+resource with no existing order, within the guardrail band, when no good-deal sell order exists", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } }; // 3 <= 10*0.8=8, within band

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy, noBestSell, true);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 3, type: "buy" }]);
  });

  it("caps a buy order's amount at the flat ceiling when the deficit exceeds it", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 50000)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy, noBestSell, true);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 3000, price: 3, type: "buy" }]);
  });

  it("emits a marketCreateOrder (sell) sized to the actual surplus for a colony+resource with no existing order, at/above the sell-capacity floor, below the force-sell threshold, and within the guardrail band", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } }; // 13 >= 10*1.2=12, within band

    const intents = marketFallback(leftover, () => 0.85, orders, avgPrices, noOrders, noBestBuy, noBestSell);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 13, type: "sell" }]);
  });

  it("emits a marketReprice (not a duplicate marketCreateOrder) when a buy order already exists at/above the wanted amount", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };
    const existing = [order({ id: "buy1", type: "buy", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 2 })];

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, existing, noBestBuy, noBestSell, true);

    // remainingAmount (3000) already exceeds wanted (500) — no extend, only reprice.
    expect(intents).toEqual([{ kind: "marketReprice", order: "buy1", price: 3 }]);
  });

  it("also emits a marketExtendOrder, sized to the real remaining need, when the existing order's remaining amount is below the wanted amount", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 5000)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };
    const existing = [order({ id: "buy1", type: "buy", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 1000, price: 2 })];

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, existing, noBestBuy, noBestSell, true);

    // wanted = min(3000, 5000) = 3000; extend tops up from 1000 to 3000.
    expect(intents).toContainEqual({ kind: "marketReprice", order: "buy1", price: 3 });
    expect(intents).toContainEqual({ kind: "marketExtendOrder", order: "buy1", amount: 2000 });
  });

  it("does not extend an existing order when its remaining amount already exceeds a shrunk wanted amount", () => {
    // The deficit dropped since the order was placed (e.g. colony-to-colony matching filled some of it) —
    // extendOrder can only add, never remove, so the order is left to shrink naturally as it fills.
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 400)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };
    const existing = [order({ id: "buy1", type: "buy", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 2 })];

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, existing, noBestBuy, noBestSell, true);

    expect(intents).toEqual([{ kind: "marketReprice", order: "buy1", price: 3 }]);
  });

  it("emits a marketDeal (force-sell, ignoring price and the guardrail) sized to the surplus when terminalCapacityPct is at/above 0.90", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 4 } }; // well outside the guardrail band
    const bestBuyOrder = () => ({ id: "otherPlayerBuy", price: 1 });

    const intents = marketFallback(leftover, () => 0.9, orders, avgPrices, noOrders, bestBuyOrder, noBestSell);

    // Force-sell deals against the best live buy order at ITS price, not our own sellMin floor — and
    // isn't blocked by the guardrail even though sellMin/the deal price are far below avgPrice*0.8.
    expect(intents).toEqual([{ kind: "marketDeal", order: "otherPlayerBuy", amount: 500, room: "W1N1" }]);
  });

  it("checks the force-sell threshold per-resource, not whole-terminal — a different resource's fullness doesn't trigger it", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } };
    // terminalCapacityPct is keyed by (colony, resource); a caller reporting near-full for a DIFFERENT
    // resource has no bearing on RESOURCE_OXYGEN's own decision here — this fixture models that isolation
    // implicitly, since only RESOURCE_OXYGEN's leftover entry is ever looked up. 0.85 clears the
    // sell-capacity floor but not the force-sell threshold, so the normal priced path runs.
    const capacityPct = (_colony: string, resource: ResourceConstant) => (resource === RESOURCE_OXYGEN ? 0.85 : 0.99);

    const intents = marketFallback(leftover, capacityPct, orders, avgPrices, noOrders, noBestBuy, noBestSell);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 13, type: "sell" }]);
  });

  it("emits nothing when leftover is empty", () => {
    expect(marketFallback([], noCapacity, {}, {}, noOrders, noBestBuy, noBestSell)).toEqual([]);
  });

  it("emits a cancel for a colony+resource+direction whose order existed previously but has no leftover entry this pass", () => {
    const existing = [order({ id: "stale1", type: "sell", resourceType: RESOURCE_OXYGEN, roomName: "W1N1" })];

    const intents = marketFallback([], noCapacity, {}, {}, existing, noBestBuy, noBestSell);

    expect(intents).toEqual([{ kind: "marketCancelOrder", order: "stale1" }]);
  });

  it("does not prune an order whose colony+resource+direction still appears in this pass's leftover", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } };
    const existing = [order({ id: "sell1", type: "sell", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 5 })];

    const intents = marketFallback(leftover, () => 0.85, orders, avgPrices, existing, noBestBuy, noBestSell);

    expect(intents).not.toContainEqual({ kind: "marketCancelOrder", order: "sell1" });
  });

  it("allows a simultaneous buy order and sell order for the same colony+resource when leftover contains both a deficit and a surplus entry for it", () => {
    // Models the empire genuinely having both sides unresolved for the same resource (different colonies
    // feeding into the same resource's independent buy/sell decisions) — decision 21.
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500), req("W2N2", RESOURCE_OXYGEN, -700)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3, sellMin: 13 } };

    const intents = marketFallback(leftover, () => 0.85, orders, avgPrices, noOrders, noBestBuy, noBestSell, true);

    expect(intents).toContainEqual({ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 3, type: "buy" });
    expect(intents).toContainEqual({ kind: "marketCreateOrder", room: "W2N2", resource: RESOURCE_OXYGEN, amount: 700, price: 13, type: "sell" });
  });

  it("emits nothing for a buy-path resource with no cached buyMax yet", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    expect(marketFallback(leftover, noCapacity, {}, avgPrices, noOrders, noBestBuy, noBestSell, true)).toEqual([]);
  });

  it("emits nothing for an above-sell-capacity-floor sell-path resource with no cached sellMin yet", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    expect(marketFallback(leftover, () => 0.85, {}, avgPrices, noOrders, noBestBuy, noBestSell)).toEqual([]);
  });

  it("force-sells nothing when no live buy order exists to deal against yet", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } };

    const intents = marketFallback(leftover, () => 0.95, orders, avgPrices, noOrders, noBestBuy, noBestSell);

    expect(intents).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // ±20% avgPrice guardrail
  // ---------------------------------------------------------------------------

  it("does not buy when the live buyMax is within 20% of the average (not cheap enough)", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 9 } }; // 9 > 10*0.8=8 -> blocked

    expect(marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy, noBestSell, true)).toEqual([]);
  });

  it("buys right at the 20%-below-average edge", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 8 } }; // exactly 10*0.8

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy, noBestSell, true);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 8, type: "buy" }]);
  });

  it("does not sell (non-force-sell path) when the live sellMin is within 20% of the average (not rich enough)", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 11 } }; // 11 < 10*1.2=12 -> blocked

    expect(marketFallback(leftover, () => 0.85, orders, avgPrices, noOrders, noBestBuy, noBestSell, undefined, false)).toEqual([]);
  });

  it("sells right at the 20%-above-average edge", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 12 } }; // exactly 10*1.2

    const intents = marketFallback(leftover, () => 0.85, orders, avgPrices, noOrders, noBestBuy, noBestSell);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 12, type: "sell" }]);
  });

  it("does not buy or sell when no avgPrice is cached yet for the resource, even with a favorable live price", () => {
    const buyLeftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const sellLeftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 0.01, sellMin: 999 } };

    expect(marketFallback(buyLeftover, noCapacity, orders, {}, noOrders, noBestBuy, noBestSell, true)).toEqual([]);
    expect(marketFallback(sellLeftover, () => 0.85, orders, {}, noOrders, noBestBuy, noBestSell)).toEqual([]);
  });

  it("prunes an existing buy order once the live price drifts outside the guardrail band, even though the deficit itself is unchanged", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 9 } }; // now too expensive (>8)
    const existing = [order({ id: "buy1", type: "buy", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 7 })];

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, existing, noBestBuy, noBestSell, true);

    expect(intents).toEqual([{ kind: "marketCancelOrder", order: "buy1" }]);
  });

  it("prunes an existing sell order once the live price drifts outside the guardrail band (non-force-sell)", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 11 } }; // now too cheap (<12)
    const existing = [order({ id: "sell1", type: "sell", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 13 })];

    const intents = marketFallback(leftover, () => 0.85, orders, avgPrices, existing, noBestBuy, noBestSell, undefined, false);

    expect(intents).toEqual([{ kind: "marketCancelOrder", order: "sell1" }]);
  });

  // ---------------------------------------------------------------------------
  // Sell-capacity floor: don't sell surplus at all until the terminal is genuinely filling up
  // ---------------------------------------------------------------------------

  it("does not sell a surplus below the sell-capacity floor, even at a great price", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 50 } }; // way above the guardrail band, would sell if capacity allowed it

    expect(marketFallback(leftover, () => 0.79, orders, avgPrices, noOrders, noBestBuy, noBestSell, undefined, false)).toEqual([]);
  });

  it("sells right at the sell-capacity floor edge", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } };

    const intents = marketFallback(leftover, () => 0.8, orders, avgPrices, noOrders, noBestBuy, noBestSell);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 13, type: "sell" }]);
  });

  it("prunes an existing standing sell order once capacity drops back below the sell-capacity floor, even though the surplus itself is unchanged", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } }; // still a fine price
    const existing = [order({ id: "sell1", type: "sell", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 13 })];

    const intents = marketFallback(leftover, () => 0.5, orders, avgPrices, existing, noBestBuy, noBestSell, undefined, false);

    expect(intents).toEqual([{ kind: "marketCancelOrder", order: "sell1" }]);
  });

  it("still force-sells below the sell-capacity floor once the force-sell threshold is reached", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const bestBuyOrder = () => ({ id: "otherPlayerBuy", price: 1 });

    const intents = marketFallback(leftover, () => 0.95, {}, avgPrices, noOrders, bestBuyOrder, noBestSell);

    expect(intents).toEqual([{ kind: "marketDeal", order: "otherPlayerBuy", amount: 500, room: "W1N1" }]);
  });

  it("keeps a standing sell order alive across the prune pass when force-selling, even though the guardrail alone would reject it", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 4 } }; // far outside the guardrail band
    const existing = [order({ id: "sell1", type: "sell", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 13 })];
    const bestBuyOrder = () => ({ id: "otherPlayerBuy", price: 1 });

    const intents = marketFallback(leftover, () => 0.9, orders, avgPrices, existing, bestBuyOrder, noBestSell);

    expect(intents).not.toContainEqual({ kind: "marketCancelOrder", order: "sell1" });
    expect(intents).toContainEqual({ kind: "marketDeal", order: "otherPlayerBuy", amount: 500, room: "W1N1" });
  });

  // ---------------------------------------------------------------------------
  // Good-deal immediate buy (deal() against a live sell order at/below avgPrice)
  // ---------------------------------------------------------------------------

  it("immediately deals against the best live sell order, sized to the actual deficit, when its price is at or below the average, instead of placing a standing buy order", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } }; // would otherwise place a standing buy at 3
    const bestSellOrder = () => ({ id: "cheapSell", price: 9, remainingAmount: 3000 }); // 9 <= avgPrice(10)

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy, bestSellOrder, true);

    expect(intents).toEqual([{ kind: "marketDeal", order: "cheapSell", amount: 500, room: "W1N1" }]);
  });

  it("deals right at the good-deal edge (sellMin exactly equal to avgPrice)", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const bestSellOrder = () => ({ id: "atAverage", price: 10, remainingAmount: 3000 }); // exactly avgPrice

    const intents = marketFallback(leftover, noCapacity, {}, avgPrices, noOrders, noBestBuy, bestSellOrder, true);

    expect(intents).toEqual([{ kind: "marketDeal", order: "atAverage", amount: 500, room: "W1N1" }]);
  });

  it("falls through to the standing-buy-order path when the best live sell order is above the average", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };
    const bestSellOrder = () => ({ id: "expensiveSell", price: 11, remainingAmount: 3000 }); // 11 > avgPrice(10)

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy, bestSellOrder, true);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 3, type: "buy" }]);
  });

  it("falls through to the standing-buy-order path when no live sell order exists at all", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy, noBestSell, true);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 3, type: "buy" }]);
  });

  it("does not immediate-deal-buy when no avgPrice is cached yet, even if a live sell order would otherwise look cheap", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const bestSellOrder = () => ({ id: "cheapSell", price: 0.01, remainingAmount: 3000 });

    const intents = marketFallback(leftover, noCapacity, {}, {}, noOrders, noBestBuy, bestSellOrder, true);

    // No avgPrice means no "good deal" judgement is possible; buyMax is also missing here so nothing at
    // all is emitted (same as any other missing-price case).
    expect(intents).toEqual([]);
  });

  it("caps the deal amount to the sell order's remainingAmount when it's smaller than the wanted amount", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 5000)];
    const bestSellOrder = () => ({ id: "smallSell", price: 5, remainingAmount: 1200 });

    const intents = marketFallback(leftover, noCapacity, {}, avgPrices, noOrders, noBestBuy, bestSellOrder, true);

    // wanted = min(3000, 5000) = 3000, but the order only has 1200 left.
    expect(intents).toEqual([{ kind: "marketDeal", order: "smallSell", amount: 1200, room: "W1N1" }]);
  });

  it("prunes a stale standing buy order once a good deal starts immediate-dealing instead", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };
    const existing = [order({ id: "buy1", type: "buy", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 2 })];
    const bestSellOrder = () => ({ id: "cheapSell", price: 9, remainingAmount: 3000 });

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, existing, noBestBuy, bestSellOrder, true);

    expect(intents).toContainEqual({ kind: "marketDeal", order: "cheapSell", amount: 500, room: "W1N1" });
    expect(intents).toContainEqual({ kind: "marketCancelOrder", order: "buy1" });
    expect(intents).not.toContainEqual(expect.objectContaining({ kind: "marketReprice" }));
  });

  // ---------------------------------------------------------------------------
  // BUYING_ACTIVATED kill switch — defaults to off; buying only happens when explicitly turned on
  // ---------------------------------------------------------------------------

  it("defaults to no buying at all when buyingActivated is omitted, even with an otherwise-valid deficit/price", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };

    // No 8th argument passed — must fall back to the BUYING_ACTIVATED module constant (false).
    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy, noBestSell);

    expect(intents).toEqual([]);
  });

  it("does not immediate-deal-buy against a good-deal sell order when buyingActivated is false", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const bestSellOrder = () => ({ id: "cheapSell", price: 9, remainingAmount: 3000 });

    const intents = marketFallback(leftover, noCapacity, {}, avgPrices, noOrders, noBestBuy, bestSellOrder, false);

    expect(intents).toEqual([]);
  });

  it("cancels an existing standing buy order outright when buyingActivated is false, even though its leftover deficit is still real", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };
    const existing = [order({ id: "buy1", type: "buy", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 2 })];

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, existing, noBestBuy, noBestSell, false);

    expect(intents).toEqual([{ kind: "marketCancelOrder", order: "buy1" }]);
  });

  it("leaves selling untouched when buyingActivated is false — the kill switch is buy-side only", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } };

    const intents = marketFallback(leftover, () => 0.85, orders, avgPrices, noOrders, noBestBuy, noBestSell, false);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 13, type: "sell" }]);
  });

  it("leaves force-selling untouched when buyingActivated is false", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const bestBuyOrder = () => ({ id: "otherPlayerBuy", price: 1 });

    const intents = marketFallback(leftover, () => 0.95, {}, avgPrices, noOrders, bestBuyOrder, noBestSell, false);

    expect(intents).toEqual([{ kind: "marketDeal", order: "otherPlayerBuy", amount: 500, room: "W1N1" }]);
  });

  // ---------------------------------------------------------------------------
  // Real-deficit sizing (never overshoot a small remaining gap; cap at the flat ceiling for a large one)
  // ---------------------------------------------------------------------------

  it("sizes a fresh standing sell order to the actual surplus, not the flat ceiling", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -1234)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } };

    const intents = marketFallback(leftover, () => 0.85, orders, avgPrices, noOrders, noBestBuy, noBestSell);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 1234, price: 13, type: "sell" }]);
  });

  it("does NOT cap a fresh standing sell order at the flat ceiling when the surplus exceeds it (sell sizing is uncapped; only buy sizing has a ceiling)", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -50000)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } };

    const intents = marketFallback(leftover, () => 0.85, orders, avgPrices, noOrders, noBestBuy, noBestSell);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 50000, price: 13, type: "sell" }]);
  });

  // ---------------------------------------------------------------------------
  // LIQUIDATION_MODE — a looser sell floor (avgPrice - 1 stddev), and SELL_CAPACITY_PCT is bypassed
  // ---------------------------------------------------------------------------

  describe("liquidationMode", () => {
    // avgPrice=10, stddevPrice=2 for RESOURCE_OXYGEN — liquidation floor is 10-2=8 (vs the ±20% guardrail's
    // normal floor of 12, which none of these sellMin values would ever clear).
    const liqPrices: MarketStats["prices"] = { O: { avgPrice: 10, stddevPrice: 2 } };

    it("sells below the sell-capacity floor when liquidating, even at 0% terminal capacity", () => {
      const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
      const orders: MarketStats["orders"] = { O: { sellMin: 9 } }; // clears avgPrice-stddev=8, would fail the normal ±20% guardrail

      const intents = marketFallback(leftover, () => 0, orders, liqPrices, noOrders, noBestBuy, noBestSell, undefined, true);

      expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 9, type: "sell" }]);
    });

    it("sells right at the avgPrice-minus-1-stddev edge", () => {
      const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
      const orders: MarketStats["orders"] = { O: { sellMin: 8 } }; // exactly 10-2

      const intents = marketFallback(leftover, () => 0, orders, liqPrices, noOrders, noBestBuy, noBestSell, undefined, true);

      expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 500, price: 8, type: "sell" }]);
    });

    it("does not sell below the avgPrice-minus-1-stddev floor even while liquidating", () => {
      const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
      const orders: MarketStats["orders"] = { O: { sellMin: 7 } }; // below 10-2=8

      expect(marketFallback(leftover, () => 0, orders, liqPrices, noOrders, noBestBuy, noBestSell, undefined, true)).toEqual([]);
    });

    it("falls back to requiring exactly avgPrice or better when stddevPrice is missing, even while liquidating", () => {
      const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
      const orders: MarketStats["orders"] = { O: { sellMin: 9 } }; // below avgPrice=10, would need stddev>=1 to clear
      const prices: MarketStats["prices"] = { O: { avgPrice: 10, stddevPrice: undefined as unknown as number } };

      expect(marketFallback(leftover, () => 0, orders, prices, noOrders, noBestBuy, noBestSell, undefined, true)).toEqual([]);
    });

    it("does not sell at all when liquidating a resource with no cached avgPrice yet", () => {
      const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
      const orders: MarketStats["orders"] = { O: { sellMin: 999 } };

      expect(marketFallback(leftover, () => 0, orders, {}, noOrders, noBestBuy, noBestSell, undefined, true)).toEqual([]);
    });

    it("still uses the normal ±20% guardrail (not the liquidation floor) when liquidationMode is false", () => {
      const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
      const orders: MarketStats["orders"] = { O: { sellMin: 9 } }; // clears the liquidation floor (8) but not the normal one (12)

      expect(marketFallback(leftover, () => 0.85, orders, liqPrices, noOrders, noBestBuy, noBestSell, undefined, false)).toEqual([]);
    });

    it("force-sell stays unguarded and unaffected by liquidationMode either way", () => {
      const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
      const bestBuyOrder = () => ({ id: "otherPlayerBuy", price: 1 });

      const intents = marketFallback(leftover, () => 0.95, {}, liqPrices, noOrders, bestBuyOrder, noBestSell, undefined, true);

      expect(intents).toEqual([{ kind: "marketDeal", order: "otherPlayerBuy", amount: 500, room: "W1N1" }]);
    });

    it("prunes an existing standing sell order once its price drifts below the liquidation floor", () => {
      const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
      const orders: MarketStats["orders"] = { O: { sellMin: 7 } }; // below 10-2=8
      const existing = [order({ id: "sell1", type: "sell", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 8 })];

      const intents = marketFallback(leftover, () => 0, orders, liqPrices, existing, noBestBuy, noBestSell, undefined, true);

      expect(intents).toEqual([{ kind: "marketCancelOrder", order: "sell1" }]);
    });

    it("never buys while liquidating, even with a favorable good-deal sell order, since zeroed targets never produce a positive leftover entry in the first place — but as a direct guard, buyingActivated still gates it", () => {
      const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)]; // a positive leftover would only occur if targets weren't actually zeroed
      const bestSellOrder = () => ({ id: "cheapSell", price: 9, remainingAmount: 3000 });

      // liquidationMode=true, buyingActivated left at its default (false) — confirms liquidation doesn't
      // implicitly turn buying on.
      const intents = marketFallback(leftover, () => 0, {}, liqPrices, noOrders, noBestBuy, bestSellOrder, undefined, true);

      expect(intents).toEqual([]);
    });
  });
});
