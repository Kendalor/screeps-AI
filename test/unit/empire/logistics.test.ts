// Unit-proves gh #59's empire logistics matcher (empire/logistics.ts) as pure functions against plain
// fixture objects — same "fake the exact Game.* store surface read" pattern
// test/unit/logistics/stewardRegister.test.ts already uses, not a live-object/mockup-server stub (see
// that file's header for why the mockup-server seam was dropped for structurally similar dispatch code;
// this module's own terminal.send()-issuing dispatch glue is committed but intentionally left untested,
// same precedent).

import { describe, expect, it } from "vitest";
import {
  availableEmpireStock,
  computeEmergencyBoostRequests,
  computeEmergencyDonorOffers,
  computeEmpireRequests,
  effectiveTargetFor,
  matchEmpireRequests,
  roleMultiplierFor,
  type ColonyBoostCensus,
  type EmpireRequest,
  type EmpireStock
} from "../../../src/empire/logistics";
import type { CreepRequest } from "../../../src/spawn/request";

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
// availableEmpireStock (gh #64)
// ---------------------------------------------------------------------------

describe("availableEmpireStock", () => {
  it("sums storage+terminal stock for a resource across every colony", () => {
    const colonies = [
      colonyStock("W1N1", stock({ GO: 1000 }), stock({ GO: 500 })),
      colonyStock("W2N2", stock({ GO: 2000 }), stock())
    ];
    expect(availableEmpireStock(colonies, "GO", () => 0)).toBe(1000 + 500 + 2000);
  });

  it("subtracts each colony's currently-reserved-to-leave stock for that resource", () => {
    const colonies = [colonyStock("W1N1", stock({ GO: 1000 }), stock())];
    expect(availableEmpireStock(colonies, "GO", colony => (colony === "W1N1" ? 300 : 0))).toBe(700);
  });

  it("sums net-of-reservation across multiple colonies independently", () => {
    const colonies = [
      colonyStock("W1N1", stock({ GO: 1000 }), stock()),
      colonyStock("W2N2", stock({ GO: 2000 }), stock())
    ];
    const reservedOf = (colony: string): number => (colony === "W1N1" ? 300 : 500);
    expect(availableEmpireStock(colonies, "GO", reservedOf)).toBe(1000 - 300 + (2000 - 500));
  });

  it("treats a missing storage or terminal as zero stock there, not a crash", () => {
    const colonies = [colonyStock("W1N1", undefined, stock({ GO: 500 })), colonyStock("W2N2", stock({ GO: 100 }), undefined)];
    expect(availableEmpireStock(colonies, "GO", () => 0)).toBe(500 + 100);
  });

  it("returns 0 for an empire with no stock and no reservations", () => {
    const colonies = [colonyStock("W1N1", stock(), stock())];
    expect(availableEmpireStock(colonies, "GO", () => 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeEmergencyBoostRequests / computeEmergencyDonorOffers (gh #71, part of the #61 boosting epic)
// ---------------------------------------------------------------------------

// Minimal fabricated CreepRequest, same pattern as boostCensus.test.ts's fakeRequest — only the fields
// computeEmergencyBoostRequests actually reads (memory.boosts, boostNeeds) matter.
function fakeBoostedRequest(boostNeeds: Partial<Record<ResourceConstant, number>>): CreepRequest {
  return {
    body: [],
    priority: 1,
    memory: { role: "hauler", home: "W1N1", boosts: ["heal"] } as CreepRequest["memory"],
    targetRoom: "W1N1",
    boostNeeds
  };
}

function fakePlainRequest(): CreepRequest {
  return {
    body: [],
    priority: 1,
    memory: { role: "hauler", home: "W1N1" } as CreepRequest["memory"],
    targetRoom: "W1N1"
  };
}

function census(colony: string, requests: readonly CreepRequest[]): ColonyBoostCensus {
  return { colony, requests };
}

describe("computeEmergencyBoostRequests", () => {
  it("sums boostNeeds across every boosted request in one colony's census into one emergency want per compound", () => {
    const censuses = [
      census("W1N1", [fakeBoostedRequest({ LO: 400 }), fakeBoostedRequest({ LO: 200, GO: 100 }), fakePlainRequest()])
    ];
    const requests = computeEmergencyBoostRequests(censuses);

    expect(requests).toHaveLength(2);
    expect(requests).toContainEqual({ colony: "W1N1", resource: "LO", amount: 600 });
    expect(requests).toContainEqual({ colony: "W1N1", resource: "GO", amount: 100 });
  });

  it("emits nothing for a colony with no boosted requests", () => {
    const censuses = [census("W1N1", [fakePlainRequest(), fakePlainRequest()])];
    expect(computeEmergencyBoostRequests(censuses)).toHaveLength(0);
  });

  it("ignores a boosted request with no boostNeeds attached", () => {
    const noNeeds: CreepRequest = {
      body: [],
      priority: 1,
      memory: { role: "hauler", home: "W1N1", boosts: ["heal"] } as CreepRequest["memory"],
      targetRoom: "W1N1"
    };
    const censuses = [census("W1N1", [noNeeds])];
    expect(computeEmergencyBoostRequests(censuses)).toHaveLength(0);
  });

  it("keeps colonies independent", () => {
    const censuses = [
      census("W1N1", [fakeBoostedRequest({ LO: 400 })]),
      census("W2N2", [fakeBoostedRequest({ LO: 300 })])
    ];
    const requests = computeEmergencyBoostRequests(censuses);
    expect(requests).toHaveLength(2);
    expect(requests).toContainEqual({ colony: "W1N1", resource: "LO", amount: 400 });
    expect(requests).toContainEqual({ colony: "W2N2", resource: "LO", amount: 300 });
  });

  it("produces a positive amount (a want), never negative, regardless of input shape", () => {
    const censuses = [census("W1N1", [fakeBoostedRequest({ LO: 400 })])];
    const requests = computeEmergencyBoostRequests(censuses);
    expect(requests[0].amount).toBeGreaterThan(0);
  });
});

describe("computeEmergencyDonorOffers", () => {
  it("offers a donor's FULL current stock (storage+terminal), not stock-above-target", () => {
    const colonies = [colonyStock("W1N1", stock({ LO: 1000 }), stock({ LO: 500 }))];
    const offers = computeEmergencyDonorOffers(colonies, "LO");

    expect(offers).toHaveLength(1);
    // Signed negative, matching matchEmpireRequests' "has-to-give" convention — the FULL 1500, no target
    // subtracted (there is no BOOST_TARGETS lookup involved in this function at all).
    expect(offers[0]).toEqual<EmpireRequest>({ colony: "W1N1", resource: "LO", amount: -1500 });
  });

  it("omits a colony with zero stock of that resource (nothing to offer)", () => {
    const colonies = [colonyStock("W1N1", stock({ LO: 0 }), undefined)];
    expect(computeEmergencyDonorOffers(colonies, "LO")).toHaveLength(0);
  });

  it("treats a missing storage or terminal as zero stock there, not a crash", () => {
    const colonies = [colonyStock("W1N1", undefined, stock({ LO: 500 }))];
    const offers = computeEmergencyDonorOffers(colonies, "LO");
    expect(offers[0].amount).toBe(-500);
  });

  it("computes offers independently per colony", () => {
    const colonies = [
      colonyStock("W1N1", stock({ LO: 1000 }), stock()),
      colonyStock("W2N2", stock({ LO: 2000 }), stock())
    ];
    const offers = computeEmergencyDonorOffers(colonies, "LO");
    expect(offers).toHaveLength(2);
    expect(offers).toContainEqual({ colony: "W1N1", resource: "LO", amount: -1000 });
    expect(offers).toContainEqual({ colony: "W2N2", resource: "LO", amount: -2000 });
  });
});

describe("emergency boost matching (gh #71): reusing matchEmpireRequests for the emergency pass", () => {
  it("matches an emergency want against a donor's full stock via the SAME matchEmpireRequests pairing function", () => {
    const wants = computeEmergencyBoostRequests([census("A", [fakeBoostedRequest({ LO: 400 })])]);
    const offers = computeEmergencyDonorOffers([colonyStock("B", stock({ LO: 1000 }), stock())], "LO");

    const { matches } = matchEmpireRequests([...wants, ...offers], () => 999999);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ from: "B", to: "A", resource: "LO", amount: 400 });
  });

  it("can drain a donor below its own target-level stock — no floor protection, plain full-stock offer", () => {
    // Donor B only has 300 LO — well below any plausible BOOST_TARGETS baseline for LO — yet it's still
    // offered in full and gets drained to zero for this compound; nothing in computeEmergencyDonorOffers or
    // matchEmpireRequests consults a target/floor at all for the emergency pass.
    const wants = computeEmergencyBoostRequests([census("A", [fakeBoostedRequest({ LO: 400 })])]);
    const offers = computeEmergencyDonorOffers([colonyStock("B", stock({ LO: 300 }), stock())], "LO");

    const { matches, leftover } = matchEmpireRequests([...wants, ...offers], () => 999999);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ from: "B", to: "A", resource: "LO", amount: 300 }); // drained to zero
    expect(leftover).toContainEqual({ colony: "A", resource: "LO", amount: 100 }); // remaining want carries over
  });

  it("pulls from the biggest available donor stock first among multiple donors, same pairing behavior as the ordinary pass", () => {
    const wants = computeEmergencyBoostRequests([census("A", [fakeBoostedRequest({ LO: 500 })])]);
    const offers = computeEmergencyDonorOffers(
      [colonyStock("B", stock({ LO: 2000 }), stock()), colonyStock("C", stock({ LO: 100 }), stock())],
      "LO"
    );

    const { matches } = matchEmpireRequests([...wants, ...offers], () => 999999);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ from: "B", to: "A", amount: 500 }); // bigger donor picked first
  });
});

// marketFallback's own decision logic (gh #60) is unit-tested in test/unit/empire/marketFallback.test.ts —
// this file stays scoped to matchEmpireRequests/computeEmpireRequests, the colony-to-colony phase.
