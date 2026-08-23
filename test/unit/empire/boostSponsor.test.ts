// pickBoostedSponsor extends pickSponsor (gh #68, epic #61) with an advisory boost-tier-availability
// check, run only after the existing no-colonies/unaffordable/unreachable checks all pass. It never
// reserves stock — it's a read-only "would a boost request currently clear the bar" gate, same spirit as
// boostAvailability.ts's own pickAvailableTier it wraps. See sponsor.ts's SponsorPick doc for the reason
// union this adds "boostTierUnavailable" to.

import { describe, expect, it } from "vitest";
import { pickBoostedSponsor } from "../../../src/empire/sponsor";
import { availableEmpireStock, type ColonyEmpireStock, type EmpireStock } from "../../../src/empire/logistics";
import { testColony, roomDistance } from "../../fixtures";

const FLOOR = 300;

function stock(overrides: Partial<Record<ResourceConstant, number>> = {}): EmpireStock {
  return { getUsedCapacity: (r: ResourceConstant) => overrides[r] ?? 0 };
}

function colonyStock(colony: string, amounts: Partial<Record<ResourceConstant, number>> = {}): ColonyEmpireStock {
  return { colony, storage: stock(amounts), terminal: undefined };
}

// Fabricated resolve table (same style as boostAvailability.test.ts) — this ticket doesn't depend on the
// real BOOSTS table, just on pickAvailableTier's walk being wired correctly.
const RESOLVE = (action: string, tier: 1 | 2 | 3): ResourceConstant | undefined => {
  const table: Record<string, Record<1 | 2 | 3, ResourceConstant>> = {
    heal: { 1: "LO" as ResourceConstant, 2: "LHO2" as ResourceConstant, 3: "XLHO2" as ResourceConstant }
  };
  return table[action]?.[tier];
};

const home = () => testColony({ name: "W1N1", energyCapacity: FLOOR });

describe("pickBoostedSponsor", () => {
  it("passes a forced-tier request when empire stock clears exactly that tier", () => {
    const colonies = [colonyStock("W1N1", { XLHO2: 100 })];
    const result = pickBoostedSponsor([home()], "W1N2", FLOOR, roomDistance, {
      requiredActions: ["heal"],
      tierRequest: { kind: "forced", tier: 3 },
      neededAmount: 50,
      resolveCompound: RESOLVE,
      colonies,
      reservedOf: () => 0
    });
    expect(result.colony?.name).toBe("W1N1");
    expect(result.reason).toBeUndefined();
  });

  it("fails a forced-tier request that's short at that exact tier, even if a lower tier would work", () => {
    // T1 (LO) has plenty of stock, but the request forces T3 (XLHO2) which is short — no fallback allowed.
    const colonies = [colonyStock("W1N1", { LO: 1000, XLHO2: 5 })];
    const result = pickBoostedSponsor([home()], "W1N2", FLOOR, roomDistance, {
      requiredActions: ["heal"],
      tierRequest: { kind: "forced", tier: 3 },
      neededAmount: 50,
      resolveCompound: RESOLVE,
      colonies,
      reservedOf: () => 0
    });
    expect(result).toEqual({ reason: "boostTierUnavailable" });
  });

  it("resolves a greedy request to the best available tier and passes", () => {
    // T3 (XLHO2) is short, but T2 (LHO2) clears the bar — greedy should fall back and still pass.
    const colonies = [colonyStock("W1N1", { XLHO2: 5, LHO2: 100 })];
    const result = pickBoostedSponsor([home()], "W1N2", FLOOR, roomDistance, {
      requiredActions: ["heal"],
      tierRequest: { kind: "greedy" },
      neededAmount: 50,
      resolveCompound: RESOLVE,
      colonies,
      reservedOf: () => 0
    });
    expect(result.colony?.name).toBe("W1N1");
    expect(result.reason).toBeUndefined();
  });

  it("fails a greedy request that's short at all three tiers", () => {
    const colonies = [colonyStock("W1N1", {})];
    const result = pickBoostedSponsor([home()], "W1N2", FLOOR, roomDistance, {
      requiredActions: ["heal"],
      tierRequest: { kind: "greedy" },
      neededAmount: 50,
      resolveCompound: RESOLVE,
      colonies,
      reservedOf: () => 0
    });
    expect(result).toEqual({ reason: "boostTierUnavailable" });
  });

  it("still reports 'no colonies' unaffected by any boost request", () => {
    const result = pickBoostedSponsor([], "W5N5", FLOOR, roomDistance, {
      requiredActions: ["heal"],
      tierRequest: { kind: "greedy" },
      neededAmount: 50,
      resolveCompound: RESOLVE,
      colonies: [],
      reservedOf: () => 0
    });
    expect(result).toEqual({ reason: "no colonies" });
  });

  it("still reports 'unaffordable' before ever consulting boost stock", () => {
    const poor = testColony({ name: "W1N1", energyCapacity: FLOOR - 1 });
    // Stock is plentiful, but the colony can't afford the op at all — boost check must never run.
    const colonies = [colonyStock("W1N1", { XLHO2: 1000 })];
    const result = pickBoostedSponsor([poor], "W1N2", FLOOR, roomDistance, {
      requiredActions: ["heal"],
      tierRequest: { kind: "forced", tier: 3 },
      neededAmount: 50,
      resolveCompound: RESOLVE,
      colonies,
      reservedOf: () => 0
    });
    expect(result).toEqual({ reason: "unaffordable" });
  });

  it("still reports 'unreachable' before failing on boost availability", () => {
    const stranded = testColony({ name: "W1N1", energyCapacity: FLOOR });
    const unreachable = () => Infinity;
    const colonies = [colonyStock("W1N1", {})]; // no boost stock either, but unreachable wins first
    const result = pickBoostedSponsor([stranded], "W9N9", FLOOR, unreachable, {
      requiredActions: ["heal"],
      tierRequest: { kind: "greedy" },
      neededAmount: 50,
      resolveCompound: RESOLVE,
      colonies,
      reservedOf: () => 0
    });
    expect(result).toEqual({ reason: "unreachable" });
  });

  it("treats an invalid tierRequest as boostTierUnavailable rather than throwing", () => {
    const colonies = [colonyStock("W1N1", { XLHO2: 1000 })];
    const result = pickBoostedSponsor([home()], "W1N2", FLOOR, roomDistance, {
      requiredActions: ["heal"],
      tierRequest: { kind: "invalid", reason: "bad segment" },
      neededAmount: 50,
      resolveCompound: RESOLVE,
      colonies,
      reservedOf: () => 0
    });
    expect(result).toEqual({ reason: "boostTierUnavailable" });
  });

  it("does not reserve/mark any stock as claimed when the check passes", () => {
    const colonies = [colonyStock("W1N1", { XLHO2: 100 })];
    pickBoostedSponsor([home()], "W1N2", FLOOR, roomDistance, {
      requiredActions: ["heal"],
      tierRequest: { kind: "forced", tier: 3 },
      neededAmount: 50,
      resolveCompound: RESOLVE,
      colonies,
      reservedOf: () => 0
    });
    // Stock is read via availableEmpireStock fresh each call — a second identical check still sees the
    // same full 100, proving nothing was decremented/claimed as a side effect of the first pass.
    expect(availableEmpireStock(colonies, "XLHO2" as ResourceConstant, () => 0)).toBe(100);
  });
});
