// Unit-proves gh #60's marketFallback (empire/marketFallback.ts) — both the credit reserve calculation
// and the buy/sell/reprice/prune decision logic — as pure functions over plain fixture data. Same
// "inject the exact Game.* surface read" pattern empire/logistics.ts's own matchEmpireRequests tests
// already use (test/unit/empire/logistics.test.ts); no live Game.rooms/Game.market involved.

import { describe, expect, it } from "vitest";
import { creditReserve, marketFallback, type LiveOrder } from "../../../src/empire/marketFallback";
import type { EmpireRequest } from "../../../src/empire/logistics";
import type { MarketStats } from "../../../src/memory/schema";

function req(colony: string, resource: ResourceConstant, amount: number): EmpireRequest {
  return { colony, resource, amount };
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

describe("marketFallback", () => {
  it("emits a marketCreateOrder (buy) for a colony+resource with no existing order and a positive leftover, within the guardrail band", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } }; // 3 <= 10*0.8=8, within band

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 3000, price: 3, type: "buy" }]);
  });

  it("emits a marketCreateOrder (sell) for a colony+resource with no existing order and a negative leftover, below the force-sell threshold and within the guardrail band", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } }; // 13 >= 10*1.2=12, within band

    const intents = marketFallback(leftover, () => 0.5, orders, avgPrices, noOrders, noBestBuy);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 3000, price: 13, type: "sell" }]);
  });

  it("emits a marketReprice (not a duplicate marketCreateOrder) when a buy order already exists at full amount", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };
    const existing = [order({ id: "buy1", type: "buy", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 2 })];

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, existing, noBestBuy);

    expect(intents).toEqual([{ kind: "marketReprice", order: "buy1", price: 3 }]);
  });

  it("also emits a marketExtendOrder when the existing order's remaining amount is below the target size", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3 } };
    const existing = [order({ id: "buy1", type: "buy", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 1000, price: 2 })];

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, existing, noBestBuy);

    expect(intents).toContainEqual({ kind: "marketReprice", order: "buy1", price: 3 });
    expect(intents).toContainEqual({ kind: "marketExtendOrder", order: "buy1", amount: 2000 });
  });

  it("emits a marketDeal (force-sell, ignoring price and the guardrail) when terminalCapacityPct is at/above 0.90 for a surplus resource", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 4 } }; // well outside the guardrail band
    const bestBuyOrder = () => ({ id: "otherPlayerBuy", price: 1 });

    const intents = marketFallback(leftover, () => 0.9, orders, avgPrices, noOrders, bestBuyOrder);

    // Force-sell deals against the best live buy order at ITS price, not our own sellMin floor — and
    // isn't blocked by the guardrail even though sellMin/the deal price are far below avgPrice*0.8.
    expect(intents).toEqual([{ kind: "marketDeal", order: "otherPlayerBuy", amount: 3000, room: "W1N1" }]);
  });

  it("checks the force-sell threshold per-resource, not whole-terminal — a different resource's fullness doesn't trigger it", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } };
    // terminalCapacityPct is keyed by (colony, resource); a caller reporting near-full for a DIFFERENT
    // resource has no bearing on RESOURCE_OXYGEN's own decision here — this fixture models that isolation
    // implicitly, since only RESOURCE_OXYGEN's leftover entry is ever looked up.
    const capacityPct = (_colony: string, resource: ResourceConstant) => (resource === RESOURCE_OXYGEN ? 0.5 : 0.99);

    const intents = marketFallback(leftover, capacityPct, orders, avgPrices, noOrders, noBestBuy);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 3000, price: 13, type: "sell" }]);
  });

  it("emits nothing when leftover is empty", () => {
    expect(marketFallback([], noCapacity, {}, {}, noOrders, noBestBuy)).toEqual([]);
  });

  it("emits a cancel for a colony+resource+direction whose order existed previously but has no leftover entry this pass", () => {
    const existing = [order({ id: "stale1", type: "sell", resourceType: RESOURCE_OXYGEN, roomName: "W1N1" })];

    const intents = marketFallback([], noCapacity, {}, {}, existing, noBestBuy);

    expect(intents).toEqual([{ kind: "marketCancelOrder", order: "stale1" }]);
  });

  it("does not prune an order whose colony+resource+direction still appears in this pass's leftover", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } };
    const existing = [order({ id: "sell1", type: "sell", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 5 })];

    const intents = marketFallback(leftover, () => 0.1, orders, avgPrices, existing, noBestBuy);

    expect(intents).not.toContainEqual({ kind: "marketCancelOrder", order: "sell1" });
  });

  it("allows a simultaneous buy order and sell order for the same colony+resource when leftover contains both a deficit and a surplus entry for it", () => {
    // Models the empire genuinely having both sides unresolved for the same resource (different colonies
    // feeding into the same resource's independent buy/sell decisions) — decision 21.
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500), req("W2N2", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 3, sellMin: 13 } };

    const intents = marketFallback(leftover, () => 0.1, orders, avgPrices, noOrders, noBestBuy);

    expect(intents).toContainEqual({ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 3000, price: 3, type: "buy" });
    expect(intents).toContainEqual({ kind: "marketCreateOrder", room: "W2N2", resource: RESOURCE_OXYGEN, amount: 3000, price: 13, type: "sell" });
  });

  it("emits nothing for a buy-path resource with no cached buyMax yet", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    expect(marketFallback(leftover, noCapacity, {}, avgPrices, noOrders, noBestBuy)).toEqual([]);
  });

  it("emits nothing for a below-threshold sell-path resource with no cached sellMin yet", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    expect(marketFallback(leftover, () => 0.1, {}, avgPrices, noOrders, noBestBuy)).toEqual([]);
  });

  it("force-sells nothing when no live buy order exists to deal against yet", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 13 } };

    const intents = marketFallback(leftover, () => 0.95, orders, avgPrices, noOrders, noBestBuy);

    expect(intents).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // ±20% avgPrice guardrail
  // ---------------------------------------------------------------------------

  it("does not buy when the live buyMax is within 20% of the average (not cheap enough)", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 9 } }; // 9 > 10*0.8=8 -> blocked

    expect(marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy)).toEqual([]);
  });

  it("buys right at the 20%-below-average edge", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 8 } }; // exactly 10*0.8

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, noOrders, noBestBuy);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 3000, price: 8, type: "buy" }]);
  });

  it("does not sell (non-force-sell path) when the live sellMin is within 20% of the average (not rich enough)", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 11 } }; // 11 < 10*1.2=12 -> blocked

    expect(marketFallback(leftover, () => 0.1, orders, avgPrices, noOrders, noBestBuy)).toEqual([]);
  });

  it("sells right at the 20%-above-average edge", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 12 } }; // exactly 10*1.2

    const intents = marketFallback(leftover, () => 0.1, orders, avgPrices, noOrders, noBestBuy);

    expect(intents).toEqual([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 3000, price: 12, type: "sell" }]);
  });

  it("does not buy or sell when no avgPrice is cached yet for the resource, even with a favorable live price", () => {
    const buyLeftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const sellLeftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 0.01, sellMin: 999 } };

    expect(marketFallback(buyLeftover, noCapacity, orders, {}, noOrders, noBestBuy)).toEqual([]);
    expect(marketFallback(sellLeftover, () => 0.1, orders, {}, noOrders, noBestBuy)).toEqual([]);
  });

  it("prunes an existing buy order once the live price drifts outside the guardrail band, even though the deficit itself is unchanged", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, 500)];
    const orders: MarketStats["orders"] = { O: { buyMax: 9 } }; // now too expensive (>8)
    const existing = [order({ id: "buy1", type: "buy", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 7 })];

    const intents = marketFallback(leftover, noCapacity, orders, avgPrices, existing, noBestBuy);

    expect(intents).toEqual([{ kind: "marketCancelOrder", order: "buy1" }]);
  });

  it("prunes an existing sell order once the live price drifts outside the guardrail band (non-force-sell)", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 11 } }; // now too cheap (<12)
    const existing = [order({ id: "sell1", type: "sell", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 13 })];

    const intents = marketFallback(leftover, () => 0.1, orders, avgPrices, existing, noBestBuy);

    expect(intents).toEqual([{ kind: "marketCancelOrder", order: "sell1" }]);
  });

  it("keeps a standing sell order alive across the prune pass when force-selling, even though the guardrail alone would reject it", () => {
    const leftover = [req("W1N1", RESOURCE_OXYGEN, -500)];
    const orders: MarketStats["orders"] = { O: { sellMin: 4 } }; // far outside the guardrail band
    const existing = [order({ id: "sell1", type: "sell", resourceType: RESOURCE_OXYGEN, roomName: "W1N1", remainingAmount: 3000, price: 13 })];
    const bestBuyOrder = () => ({ id: "otherPlayerBuy", price: 1 });

    const intents = marketFallback(leftover, () => 0.9, orders, avgPrices, existing, bestBuyOrder);

    expect(intents).not.toContainEqual({ kind: "marketCancelOrder", order: "sell1" });
    expect(intents).toContainEqual({ kind: "marketDeal", order: "otherPlayerBuy", amount: 3000, room: "W1N1" });
  });
});
