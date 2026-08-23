// Unit-proves gh #60's order-book scan-reduce (empire/marketOrders.ts). Pure function, plain Order[] in,
// plain MarketStats["orders"] out — same "fake the exact data shape read" pattern
// test/unit/empire/market.test.ts's summarizeMarketHistory tests already use.

import { describe, expect, it } from "vitest";
import { summarizeOrders } from "../../../src/empire/marketOrders";

function order(overrides: Partial<Order>): Order {
  return {
    id: "order1",
    created: 0,
    type: ORDER_SELL,
    resourceType: RESOURCE_OXYGEN,
    roomName: "W1N1",
    amount: 1000,
    remainingAmount: 1000,
    price: 1,
    ...overrides
  };
}

const noOwnOrders: ReadonlySet<string> = new Set();

describe("summarizeOrders", () => {
  it("keeps the best (lowest) sell price per resource", () => {
    const orders = [
      order({ id: "s1", type: ORDER_SELL, resourceType: RESOURCE_OXYGEN, price: 5 }),
      order({ id: "s2", type: ORDER_SELL, resourceType: RESOURCE_OXYGEN, price: 2 }),
      order({ id: "s3", type: ORDER_SELL, resourceType: RESOURCE_OXYGEN, price: 8 })
    ];

    const result = summarizeOrders(orders, noOwnOrders);

    expect(result[RESOURCE_OXYGEN]?.sellMin).toBe(2);
  });

  it("keeps the best (highest) buy price per resource", () => {
    const orders = [
      order({ id: "b1", type: ORDER_BUY, resourceType: RESOURCE_OXYGEN, price: 3 }),
      order({ id: "b2", type: ORDER_BUY, resourceType: RESOURCE_OXYGEN, price: 9 }),
      order({ id: "b3", type: ORDER_BUY, resourceType: RESOURCE_OXYGEN, price: 1 })
    ];

    const result = summarizeOrders(orders, noOwnOrders);

    expect(result[RESOURCE_OXYGEN]?.buyMax).toBe(9);
  });

  it("ignores resources outside BOOST_TARGETS", () => {
    // RESOURCE_ENERGY has no configured boost-line target (see boostTargets.ts's own header) — an order
    // for it must be dropped entirely, not folded into some unrelated bucket.
    const orders = [order({ resourceType: RESOURCE_ENERGY, type: ORDER_SELL, price: 1 })];

    const result = summarizeOrders(orders, noOwnOrders);

    expect(result).toEqual({});
  });

  it("handles a resource with only sell orders — buyMax stays omitted, not zeroed", () => {
    const orders = [order({ type: ORDER_SELL, resourceType: RESOURCE_OXYGEN, price: 4 })];

    const result = summarizeOrders(orders, noOwnOrders);

    expect(result[RESOURCE_OXYGEN]).toEqual({ sellMin: 4 });
    expect(result[RESOURCE_OXYGEN]?.buyMax).toBeUndefined();
  });

  it("handles a resource with only buy orders — sellMin stays omitted, not zeroed", () => {
    const orders = [order({ type: ORDER_BUY, resourceType: RESOURCE_OXYGEN, price: 4 })];

    const result = summarizeOrders(orders, noOwnOrders);

    expect(result[RESOURCE_OXYGEN]).toEqual({ buyMax: 4 });
    expect(result[RESOURCE_OXYGEN]?.sellMin).toBeUndefined();
  });

  it("returns an empty object for an empty order list", () => {
    expect(summarizeOrders([], noOwnOrders)).toEqual({});
  });

  it("keeps multiple resources independently", () => {
    const orders = [
      order({ resourceType: RESOURCE_OXYGEN, type: ORDER_SELL, price: 2 }),
      order({ resourceType: RESOURCE_HYDROGEN, type: ORDER_BUY, price: 7 })
    ];

    const result = summarizeOrders(orders, noOwnOrders);

    expect(result[RESOURCE_OXYGEN]).toEqual({ sellMin: 2 });
    expect(result[RESOURCE_HYDROGEN]).toEqual({ buyMax: 7 });
  });

  // ---------------------------------------------------------------------------
  // Own-order exclusion — a colony must never price against its own standing order
  // ---------------------------------------------------------------------------

  it("excludes our own order (by id) from the reduction entirely, even when it would otherwise be the best price", () => {
    const orders = [
      order({ id: "ourBuy", type: ORDER_BUY, resourceType: RESOURCE_OXYGEN, roomName: "W1N1", price: 99 }),
      order({ id: "theirBuy", type: ORDER_BUY, resourceType: RESOURCE_OXYGEN, roomName: "W2N2", price: 5 })
    ];
    const ownOrderIds = new Set(["ourBuy"]);

    const result = summarizeOrders(orders, ownOrderIds);

    // Without exclusion this would be 99 (our own order, higher) — must fall through to the real
    // competitor's price instead.
    expect(result[RESOURCE_OXYGEN]?.buyMax).toBe(5);
  });

  it("omits a resource entirely when every order for it is our own", () => {
    const orders = [order({ id: "ourSell", type: ORDER_SELL, resourceType: RESOURCE_OXYGEN, roomName: "W1N1", price: 10 })];
    const ownOrderIds = new Set(["ourSell"]);

    const result = summarizeOrders(orders, ownOrderIds);

    expect(result[RESOURCE_OXYGEN]).toBeUndefined();
  });
});
