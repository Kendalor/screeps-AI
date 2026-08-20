// Unit-proves gh #59's empire logistics matcher (empire/logistics.ts) as pure functions against plain
// fixture objects — same "fake the exact Game.* store surface read" pattern
// test/unit/logistics/stewardRegister.test.ts already uses, not a live-object/mockup-server stub (see
// that file's header for why the mockup-server seam was dropped for structurally similar dispatch code;
// this module's own terminal.send()-issuing dispatch glue is committed but intentionally left untested,
// same precedent).

import { describe, expect, it } from "vitest";
import {
  computeEmpireRequests,
  effectiveTargetFor,
  marketFallback,
  matchEmpireRequests,
  roleMultiplierFor,
  type EmpireRequest,
  type EmpireStock
} from "../../../src/empire/logistics";

function stock(overrides: Partial<Record<ResourceConstant, number>> = {}): EmpireStock {
  return {
    getUsedCapacity: (r: ResourceConstant) => overrides[r] ?? 0
  };
}

function colonyStock(colony: string, storage: EmpireStock | undefined, terminal: EmpireStock | undefined) {
  return { colony, storage, terminal };
}

// ---------------------------------------------------------------------------
// roleMultiplierFor / effectiveTargetFor
// ---------------------------------------------------------------------------

describe("roleMultiplierFor", () => {
  it("is 1.0 (neutral) when no role is set", () => {
    expect(roleMultiplierFor(undefined)).toBe(1.0);
  });

  it("is greater than 1.0 for frontline", () => {
    expect(roleMultiplierFor("frontline")).toBeGreaterThan(1.0);
  });

  it("is less than 1.0 for backline", () => {
    expect(roleMultiplierFor("backline")).toBeLessThan(1.0);
  });
});

describe("effectiveTargetFor", () => {
  it("multiplies the base target by the role multiplier", () => {
    expect(effectiveTargetFor(3000, "frontline")).toBe(3000 * roleMultiplierFor("frontline"));
    expect(effectiveTargetFor(3000, undefined)).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// computeEmpireRequests
// ---------------------------------------------------------------------------

describe("computeEmpireRequests", () => {
  it("emits a positive (wants) request for a colony below its effective target", () => {
    const colonies = [colonyStock("W1N1", stock({ GO: 1000 }), stock())];
    const requests = computeEmpireRequests(colonies, { GO: 6000 }, () => undefined);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual<EmpireRequest>({ colony: "W1N1", resource: "GO", amount: 5000 });
  });

  it("emits a negative (has-to-give) request for a colony above its effective target", () => {
    const colonies = [colonyStock("W1N1", stock({ GO: 9000 }), stock())];
    const requests = computeEmpireRequests(colonies, { GO: 6000 }, () => undefined);

    expect(requests).toHaveLength(1);
    expect(requests[0].amount).toBe(-3000);
  });

  it("omits a colony exactly at its effective target", () => {
    const colonies = [colonyStock("W1N1", stock({ GO: 6000 }), stock())];
    const requests = computeEmpireRequests(colonies, { GO: 6000 }, () => undefined);
    expect(requests).toHaveLength(0);
  });

  it("sums storage AND terminal stock, not just one", () => {
    const colonies = [colonyStock("W1N1", stock({ GO: 1000 }), stock({ GO: 500 }))];
    const requests = computeEmpireRequests(colonies, { GO: 6000 }, () => undefined);
    expect(requests[0].amount).toBe(6000 - 1500);
  });

  it("treats a missing storage or terminal as zero stock there, not a crash", () => {
    const colonies = [colonyStock("W1N1", undefined, stock({ GO: 500 }))];
    const requests = computeEmpireRequests(colonies, { GO: 6000 }, () => undefined);
    expect(requests[0].amount).toBe(6000 - 500);
  });

  it("skips resources with no configured target entirely, even if the colony holds stock of them", () => {
    const colonies = [colonyStock("W1N1", stock({ GO: 6000, ZK: 1000 }), stock())];
    const requests = computeEmpireRequests(colonies, { GO: 6000 }, () => undefined);
    expect(requests).toHaveLength(0); // GO is exactly at target (no request); ZK has no configured target at all
  });

  it("biases the effective target up for a frontline colony, producing a bigger deficit than neutral", () => {
    const colonies = [colonyStock("W1N1", stock({ GO: 1000 }), stock())];
    const neutral = computeEmpireRequests(colonies, { GO: 6000 }, () => undefined);
    const frontline = computeEmpireRequests(colonies, { GO: 6000 }, () => "frontline");
    expect(frontline[0].amount).toBeGreaterThan(neutral[0].amount);
  });

  it("biases the effective target down for a backline colony", () => {
    const colonies = [colonyStock("W1N1", stock({ GO: 1000 }), stock())];
    const neutral = computeEmpireRequests(colonies, { GO: 6000 }, () => undefined);
    const backline = computeEmpireRequests(colonies, { GO: 6000 }, () => "backline");
    expect(backline[0].amount).toBeLessThan(neutral[0].amount);
  });

  it("emits independent requests per colony per resource", () => {
    const targets = { GO: 6000, GHO2: 3000 };
    const colonies = [
      colonyStock("W1N1", stock({ GO: 1000, GHO2: 4000 }), stock()),
      colonyStock("W2N2", stock({ GO: 9000, GHO2: 3000 }), stock()) // GHO2 exactly at target -> no request
    ];
    const requests = computeEmpireRequests(colonies, targets, () => undefined);
    expect(requests).toHaveLength(3);
    expect(requests).toContainEqual({ colony: "W1N1", resource: "GO", amount: 5000 });
    expect(requests).toContainEqual({ colony: "W1N1", resource: "GHO2", amount: -1000 });
    expect(requests).toContainEqual({ colony: "W2N2", resource: "GO", amount: -3000 });
  });
});

// ---------------------------------------------------------------------------
// matchEmpireRequests
// ---------------------------------------------------------------------------

function req(colony: string, resource: ResourceConstant, amount: number): EmpireRequest {
  return { colony, resource, amount };
}

describe("matchEmpireRequests", () => {
  it("pairs the biggest surplus against the biggest deficit for a resource first", () => {
    // Two surpluses (B bigger than C), one deficit (A) exactly matching B's surplus — proves B (the
    // bigger surplus) is picked over C on the first pairing, not registration order.
    const requests = [req("A", "GO", 3000), req("B", "GO", -3000), req("C", "GO", -1000)];
    const { matches } = matchEmpireRequests(requests, () => 999999);

    expect(matches).toHaveLength(1); // A's deficit is fully satisfied by B alone; C's surplus is untouched
    expect(matches[0]).toMatchObject({ from: "B", to: "A", resource: "GO", amount: 3000 });
  });

  it("keeps pairing repeatedly until one side of a resource's requests is exhausted", () => {
    const requests = [req("A", "GO", 5000), req("B", "GO", -3000), req("C", "GO", -1000)];
    const { matches } = matchEmpireRequests(requests, () => 999999);

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ from: "B", to: "A", amount: 3000 }); // biggest surplus first
    expect(matches[1]).toMatchObject({ from: "C", to: "A", amount: 1000 }); // then the next-biggest
  });

  it("caps the transfer amount by the receiver's terminal free capacity", () => {
    const requests = [req("A", "GO", 5000), req("B", "GO", -3000)];
    const { matches } = matchEmpireRequests(requests, () => 1000);
    expect(matches[0].amount).toBe(1000);
  });

  it("caps the transfer amount by the smaller of sender surplus / receiver deficit / free capacity", () => {
    const requests = [req("A", "GO", 500), req("B", "GO", -3000)];
    const { matches } = matchEmpireRequests(requests, () => 999999);
    expect(matches[0].amount).toBe(500); // deficit (500) < surplus (3000)
  });

  it("matches independently per resource", () => {
    const requests = [
      req("A", "GO", 5000),
      req("B", "GO", -3000),
      req("A", "GHO2", -2000),
      req("B", "GHO2", 1000)
    ];
    const { matches } = matchEmpireRequests(requests, () => 999999);
    expect(matches).toHaveLength(2);
    expect(matches.find(m => m.resource === "GO")).toMatchObject({ from: "B", to: "A" });
    expect(matches.find(m => m.resource === "GHO2")).toMatchObject({ from: "A", to: "B" });
  });

  it("returns unmatched leftover requests for the market-fallback phase", () => {
    // Only wants, no surplus anywhere for this resource — nothing to pair against.
    const requests = [req("A", "GO", 5000), req("B", "GO", 2000)];
    const { matches, leftover } = matchEmpireRequests(requests, () => 999999);
    expect(matches).toHaveLength(0);
    expect(leftover).toHaveLength(2);
  });

  it("does not match a colony against itself", () => {
    const requests = [req("A", "GO", 5000), req("A", "GHO2", -3000)];
    const { matches } = matchEmpireRequests(requests, () => 999999);
    expect(matches).toHaveLength(0);
  });

  it("produces no matches when every request for a resource is the same sign", () => {
    const requests = [req("A", "GO", -5000), req("B", "GO", -3000)];
    const { matches, leftover } = matchEmpireRequests(requests, () => 999999);
    expect(matches).toHaveLength(0);
    expect(leftover).toHaveLength(2);
  });

  it("only matches pairs with a positive computable amount (skips a zero-capacity receiver)", () => {
    const requests = [req("A", "GO", 5000), req("B", "GO", -3000)];
    const { matches, leftover } = matchEmpireRequests(requests, () => 0);
    expect(matches).toHaveLength(0);
    expect(leftover).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Send-cost accounting (decision 8): energy carve-out vs. non-energy floor path
// ---------------------------------------------------------------------------

describe("matchEmpireRequests send-cost accounting for RESOURCE_ENERGY", () => {
  it("carves the transaction fee out of the send amount when the resource itself is energy", () => {
    const requests = [req("A", RESOURCE_ENERGY, 10_000), req("B", RESOURCE_ENERGY, -10_000)];
    const sendCost = (amount: number) => Math.ceil(amount * 0.1); // stand-in for calcTransactionCost
    const { matches } = matchEmpireRequests(requests, () => 999999, sendCost);

    // Naive cap (min(surplus, deficit, freeCap)) would be 10000; the fee must be carved out of that so
    // store - sendCost(amount) - amount >= 0 for a self-consistent send.
    expect(matches).toHaveLength(1);
    expect(matches[0].amount).toBeLessThan(10_000);
  });

  it("does not shrink a non-energy send for its own fee (paid from the terminal's separate energy floor instead)", () => {
    const requests = [req("A", "GO", 10_000), req("B", "GO", -10_000)];
    const sendCost = (amount: number) => Math.ceil(amount * 0.1);
    const { matches } = matchEmpireRequests(requests, () => 999999, sendCost);

    expect(matches).toHaveLength(1);
    expect(matches[0].amount).toBe(10_000); // no carve-out for a non-energy resource
  });
});

// ---------------------------------------------------------------------------
// marketFallback: structural stub only (decision 13)
// ---------------------------------------------------------------------------

describe("marketFallback", () => {
  it("is a no-op stub that returns nothing yet", () => {
    const leftover = [req("A", "GO", 5000)];
    expect(marketFallback(leftover)).toBeUndefined();
  });
});
