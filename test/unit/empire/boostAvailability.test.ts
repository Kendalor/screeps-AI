import { describe, expect, it } from "vitest";
import { pickAvailableTier, resolveCompoundViaBoostActions } from "../../../src/empire/boostAvailability";

// Fabricated compound-per-tier resolution + stock, independent of #62's real boostActions.ts (not yet
// landed at the time this was written — see boostAvailability.ts's header for why the dependency is
// injected rather than imported).
const RESOLVE = (action: string, tier: 1 | 2 | 3): ResourceConstant | undefined => {
  const table: Record<string, Record<1 | 2 | 3, ResourceConstant>> = {
    heal: { 1: "LO" as ResourceConstant, 2: "LHO2" as ResourceConstant, 3: "XLHO2" as ResourceConstant },
    attack: { 1: "UH" as ResourceConstant, 2: "UH2O" as ResourceConstant, 3: "XUH2O" as ResourceConstant }
  };
  return table[action]?.[tier];
};

describe("pickAvailableTier", () => {
  it("returns T3 when the empire has sufficient T3 stock for every required action", () => {
    const stock = (resource: ResourceConstant): number => (resource === "XLHO2" ? 100 : 0);
    const result = pickAvailableTier(["heal"], RESOLVE, stock, 50);
    expect(result).toEqual({ kind: "available", tier: 3 });
  });

  it("falls back to T2 when T3 stock is insufficient but T2 stock is sufficient", () => {
    const stock = (resource: ResourceConstant): number => {
      if (resource === "XLHO2") return 10; // insufficient
      if (resource === "LHO2") return 100; // sufficient
      return 0;
    };
    const result = pickAvailableTier(["heal"], RESOLVE, stock, 50);
    expect(result).toEqual({ kind: "available", tier: 2 });
  });

  it("falls back to T1 when T3 and T2 stock are both insufficient but T1 stock is sufficient", () => {
    const stock = (resource: ResourceConstant): number => {
      if (resource === "XLHO2") return 5;
      if (resource === "LHO2") return 5;
      if (resource === "LO") return 100;
      return 0;
    };
    const result = pickAvailableTier(["heal"], RESOLVE, stock, 50);
    expect(result).toEqual({ kind: "available", tier: 1 });
  });

  it("returns an unavailable result (not a default/fallback tier) when all three tiers are insufficient", () => {
    const stock = (): number => 0;
    const result = pickAvailableTier(["heal"], RESOLVE, stock, 50);
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("requires EVERY action to clear the bar at a tier, not just some of them", () => {
    // heal has plenty of T3 stock, but attack's T3 compound is short — so T3 must be rejected overall,
    // even though the plain per-action check would pass for heal alone.
    const stock = (resource: ResourceConstant): number => {
      if (resource === "XLHO2") return 100; // heal T3: sufficient
      if (resource === "XUH2O") return 5; // attack T3: insufficient
      if (resource === "UH2O") return 100; // attack T2: sufficient
      if (resource === "LHO2") return 100; // heal T2: sufficient
      return 0;
    };
    const result = pickAvailableTier(["heal", "attack"], RESOLVE, stock, 50);
    expect(result).toEqual({ kind: "available", tier: 2 });
  });
});

describe("resolveCompoundViaBoostActions (real #62 integration)", () => {
  it("resolves a known action's tier to boostActionFor's real compound", () => {
    expect(resolveCompoundViaBoostActions("rangedAttack", 1)).toBe(RESOURCE_KEANIUM_OXIDE);
    expect(resolveCompoundViaBoostActions("rangedAttack", 3)).toBe(RESOURCE_CATALYZED_KEANIUM_ALKALIDE);
  });

  it("returns undefined for an unknown action at any tier", () => {
    expect(resolveCompoundViaBoostActions("teleport", 1)).toBeUndefined();
  });

  it("wires end-to-end through pickAvailableTier using the real adapter", () => {
    const stock = (resource: ResourceConstant): number => (resource === RESOURCE_CATALYZED_KEANIUM_ALKALIDE ? 100 : 0);
    const result = pickAvailableTier(["rangedAttack"], resolveCompoundViaBoostActions, stock, 50);
    expect(result).toEqual({ kind: "available", tier: 3 });
  });
});
