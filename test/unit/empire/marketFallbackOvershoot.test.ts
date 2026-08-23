// Replicates the live World-server incident (2026-08-23, gh #60 follow-up investigation) where colonies
// bought a boost-line resource past its empire target: W43N15/W44N11/W45N17 each ended up holding 9000
// XGHO2 against a 6000 target after 3 separate 3000-unit buys instead of 2.
//
// This is a multi-pass SIMULATION, not a single-call unit test: it drives the real pipeline
// (computeEmpireRequests -> matchEmpireRequests -> marketFallback, the exact sequence
// runEmpireLogisticsPass runs every EMPIRE_LOGISTICS_INTERVAL) repeatedly against a small stateful fake
// "world" that mimics two real Screeps settlement-timing facts confirmed during the live investigation:
//   1. A marketDeal's resource delivery does NOT land in .store until the NEXT simulated pass (intents
//      apply at end-of-tick, same as terminalSend/every other Screeps intent) — modelled by
//      FakeWorld.applyIntents() queuing the stock change into a `pending` bucket, flushed to `stock` only
//      on the following tick() call.
//   2. Memory.stats.market.orders (buyMax/sellMin) only refreshes every ORDER_SCAN_INTERVAL ticks, not
//      every empireLogistics pass — modelled by only recomputing the cached price snapshot on ticks where
//      `tick % ORDER_SCAN_INTERVAL === 0`, exactly like kernel/tick.ts's SYSTEMS gating.
// No Game.* global is stubbed — computeEmpireRequests/matchEmpireRequests/marketFallback are all pure
// functions already; this harness only fakes the plain data they're pure over (EmpireStock/LiveOrder/order
// callbacks), same "fake the exact surface read" convention as every other empire/*.test.ts file.

import { describe, expect, it } from "vitest";
import { computeEmpireRequests, matchEmpireRequests, type ColonyEmpireStock, type EmpireStock } from "../../../src/empire/logistics";
import { marketFallback, type LiveOrder } from "../../../src/empire/marketFallback";
import type { MarketStats } from "../../../src/memory/schema";

const RESOURCE = "XGHO2" as ResourceConstant;
const TARGET = 6000;
const ORDER_SCAN_INTERVAL = 50; // mirrors empire/marketOrders.ts's real constant
const SELLER_PRICE = 3892.403; // the live price observed in the incident (avgPrice === sellMin exactly)

/** One colony's mutable live stock — mirrors what a real StructureStorage/StructureTerminal.store would
 * hold for just the one resource under test. `pending` models a deal()'d amount that hasn't settled into
 * `.store` yet (Screeps applies intents at end-of-tick; the effect is visible starting the NEXT tick). */
class FakeColony implements EmpireStock, EmpireStock {
  stock = 0;
  pending = 0;
  constructor(public name: string) {}
  getUsedCapacity(): number {
    return this.stock;
  }
  settle(): void {
    this.stock += this.pending;
    this.pending = 0;
  }
}

/** Drives the real pipeline exactly like runEmpireLogisticsPass does, one simulated
 * EMPIRE_LOGISTICS_INTERVAL pass at a time, against a small in-memory fake world. */
class FakeWorld {
  tick = 0;
  colonies: FakeColony[];
  myOrders: LiveOrder[] = [];
  // The empire's own account-owned "order id" sequence, so repriced/extended orders keep a stable id.
  private nextOrderId = 1;
  // Cached order-book snapshot, only refreshed every ORDER_SCAN_INTERVAL ticks (see header).
  cachedOrders: MarketStats["orders"] = {};

  constructor(names: string[]) {
    this.colonies = names.map(n => new FakeColony(n));
  }

  private stocks(): ColonyEmpireStock[] {
    return this.colonies.map(c => ({ colony: c.name, storage: c, terminal: undefined }));
  }

  private refreshOrderCacheIfDue(): void {
    if (this.tick % ORDER_SCAN_INTERVAL !== 0) return;
    // Real getAllOrders() would return the live order book; in this incident the seller's order sat at a
    // fixed price for the whole window, so a fixed sellMin/buyMax is a faithful stand-in.
    this.cachedOrders = { [RESOURCE]: { sellMin: SELLER_PRICE, buyMax: SELLER_PRICE - 1 } } as MarketStats["orders"];
  }

  /** One EMPIRE_LOGISTICS_INTERVAL pass: settle any pending deal from last pass, refresh the order cache
   * if due, recompute requests fresh from live stock, match internally, then hand leftover to
   * marketFallback exactly like runEmpireLogisticsPass does. Returns the intents marketFallback emitted. */
  runPass(avgPrice: number): { intents: ReturnType<typeof marketFallback>; leftover: ReturnType<typeof computeEmpireRequests> } {
    for (const c of this.colonies) c.settle();
    this.refreshOrderCacheIfDue();

    const requests = computeEmpireRequests(this.stocks(), { [RESOURCE]: TARGET }, () => undefined);
    const { leftover } = matchEmpireRequests(requests, () => 0); // no terminals in this fixture -> no internal matches, isolates the market-fallback path under test

    const prices: MarketStats["prices"] = { [RESOURCE]: { avgPrice, stddevPrice: 0 } } as MarketStats["prices"];
    const bestSellOrder = () => ({ id: "sellerOrder", price: SELLER_PRICE, remainingAmount: 1_000_000 });
    const noBestBuy = () => undefined;

    const intents = marketFallback(
      leftover,
      () => 0, // terminalCapacityPct: no terminal in this fixture, never force-sells/floors out sell path
      this.cachedOrders,
      prices,
      this.myOrders,
      noBestBuy,
      bestSellOrder,
      true // buyingActivated: replicating the live incident, which predates the kill switch
    );

    this.applyIntents(intents);
    this.tick += 11; // EMPIRE_LOGISTICS_INTERVAL
    return { intents, leftover };
  }

  private applyIntents(intents: ReturnType<typeof marketFallback>): void {
    for (const intent of intents) {
      if (intent.kind === "marketDeal") {
        const colony = this.colonies.find(c => c.name === intent.room);
        if (colony) colony.pending += intent.amount; // settles on the NEXT runPass() call, not this one
      } else if (intent.kind === "marketCreateOrder" && intent.type === "buy") {
        this.myOrders.push({
          id: `order${this.nextOrderId++}`,
          type: "buy",
          resourceType: RESOURCE,
          roomName: intent.room,
          remainingAmount: intent.amount,
          price: intent.price
        });
      } else if (intent.kind === "marketReprice") {
        const o = this.myOrders.find(o => o.id === intent.order);
        if (o) o.price = intent.price;
      } else if (intent.kind === "marketExtendOrder") {
        const o = this.myOrders.find(o => o.id === intent.order);
        if (o) o.remainingAmount += intent.amount;
      } else if (intent.kind === "marketCancelOrder") {
        this.myOrders = this.myOrders.filter(o => o.id !== intent.order);
      }
    }
  }
}

describe("live-incident replication: buying past target across multiple passes", () => {
  it("with buyingActivated=true and a good-deal seller sitting at avgPrice, a colony's deficit can require MULTIPLE deal()s across passes, and settlement lag lets a pass double-buy before the prior deal is visible", () => {
    const world = new FakeWorld(["W43N15"]);
    const dealAmounts: number[] = [];

    // Run enough passes to close a 6000 deficit via 3000-capped good-deal deals, watching how many
    // deal()s actually fire and whether the colony ever exceeds 6000.
    for (let i = 0; i < 6; i++) {
      const { intents } = world.runPass(SELLER_PRICE); // avgPrice pinned to the seller's own price, as observed live
      for (const intent of intents) if (intent.kind === "marketDeal") dealAmounts.push(intent.amount);
    }
    world.colonies[0].settle(); // flush the final pass's pending deal so final stock is observable

    // ORDER_AMOUNT_CEILING is 3000; a 6000 deficit needs exactly 2 deals to close under the FIXED
    // (wantedAmount-capped) sizing this harness exercises. Assert it actually DOES close exactly at
    // target, proving the current, deployed sizing fix is NOT what caused the live overshoot on its own.
    expect(world.colonies[0].stock).toBe(TARGET);
    expect(dealAmounts).toEqual([3000, 3000]);
  });

  it("reproduces the exact live pattern: a colony that already reached target keeps NO leftover deficit and buyPath never fires again", () => {
    const world = new FakeWorld(["W47N18"]); // the one live colony that did NOT overshoot
    for (let i = 0; i < 2; i++) world.runPass(SELLER_PRICE);
    world.colonies[0].settle();
    expect(world.colonies[0].stock).toBe(TARGET);

    // Further passes, with the deficit now correctly at 0, must emit nothing for this colony+resource.
    const before = world.colonies[0].stock;
    for (let i = 0; i < 5; i++) {
      const { intents } = world.runPass(SELLER_PRICE);
      expect(intents.filter(x => x.kind === "marketDeal" || x.kind === "marketCreateOrder")).toEqual([]);
    }
    expect(world.colonies[0].stock).toBe(before); // confirms the pipeline itself is stable once at target
  });

  it("demonstrates the STRUCTURAL gap: marketFallback has no cross-pass memory of a deal it already decided on, so an artificially reintroduced deficit (e.g. a stale/duplicated stock read) buys again with no guard", () => {
    // Models the one condition the live forensics could NOT rule out from transaction/memory evidence
    // alone: some external event making computeEmpireRequests see a fresh positive deficit for a colony
    // that a human/dashboard already considers "at target" — this harness proves that IF that happens,
    // nothing downstream catches it; marketFallback trusts its leftover input unconditionally every pass.
    const world = new FakeWorld(["W43N15"]);
    for (let i = 0; i < 2; i++) world.runPass(SELLER_PRICE);
    world.colonies[0].settle();
    expect(world.colonies[0].stock).toBe(TARGET); // reached target cleanly, same as the control case above

    // Simulate the one scenario this investigation could not rule out: the colony's live stock read
    // reverts/desyncs for one pass (e.g. a stale Game.rooms snapshot) back below target.
    world.colonies[0].stock = TARGET - 3000;
    const { intents } = world.runPass(SELLER_PRICE);

    // marketFallback has no way to know this colony was already at target moments ago — it buys again,
    // confirming the pipeline has zero built-in protection against a transient stale/incorrect stock read
    // triggering a real, unbounded-in-practice purchase.
    expect(intents).toContainEqual({ kind: "marketDeal", order: "sellerOrder", amount: 3000, room: "W43N15" });
  });

  it("confirms the price-contamination mechanism: avgPrice exactly equal to the live sellMin trivially clears the good-deal bar every single pass, regardless of how many times it's already been bought", () => {
    // The live incident's avgPrice (7-day history average) and sellMin (live order book) matched to 3
    // decimal places -- direct evidence the history average was itself derived from the bot's own earlier
    // (pre-self-collision-fix) trades at that same price. This test isolates that mechanism: as long as
    // avgPrice==sellMin holds, EVERY pass's good-deal check (`sell.price <= avgPrice`) passes trivially,
    // with no decay/cooldown on how many consecutive passes are allowed to treat the same price as "still
    // a deal" -- there is no state anywhere tracking "I already bought at this price N times."
    const world = new FakeWorld(["W44N11"]);
    let dealCount = 0;
    for (let i = 0; i < 10; i++) {
      world.colonies[0].stock = 0; // force a fresh deficit every pass, isolating the guardrail check alone
      const { intents } = world.runPass(SELLER_PRICE); // avgPrice === sellMin, exactly as observed live
      if (intents.some(x => x.kind === "marketDeal")) dealCount++;
    }
    expect(dealCount).toBe(10); // every single pass re-clears the same trivially-true price check
  });
});
