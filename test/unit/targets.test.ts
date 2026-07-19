import { describe, expect, it } from "vitest";
import { matchesWhere, type TargetCandidate } from "../../src/behaviors/targets";

// A candidate carries only the facts the `where` predicates read — a snapshot,
// not a live game object, so the filter is unit-testable.
function struct(over: Partial<TargetCandidate>): TargetCandidate {
  return { freeCapacity: 0, usedCapacity: 0, hits: 100, hitsMax: 100, ...over };
}

describe("target where-filter", () => {
  it("notFull matches only candidates with spare capacity", () => {
    expect(matchesWhere(struct({ freeCapacity: 50 }), "notFull")).toBe(true);
    expect(matchesWhere(struct({ freeCapacity: 0 }), "notFull")).toBe(false);
  });

  it("hasEnergy matches only candidates holding resources", () => {
    expect(matchesWhere(struct({ usedCapacity: 50 }), "hasEnergy")).toBe(true);
    expect(matchesWhere(struct({ usedCapacity: 0 }), "hasEnergy")).toBe(false);
  });

  it("damaged matches only candidates below full hits", () => {
    expect(matchesWhere(struct({ hits: 50, hitsMax: 100 }), "damaged")).toBe(true);
    expect(matchesWhere(struct({ hits: 100, hitsMax: 100 }), "damaged")).toBe(false);
  });

  it("an absent where clause matches everything", () => {
    expect(matchesWhere(struct({ freeCapacity: 0, usedCapacity: 0 }), undefined)).toBe(true);
  });
});
