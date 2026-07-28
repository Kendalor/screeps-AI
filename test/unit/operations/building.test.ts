// The Building operation: the dedicated builder workforce that services outstanding construction.
// Quota scales by WORK parts, not headcount: 1 WORK per 1k of outstanding progress, translated into
// creeps via the current builder body's WORK count, capped at maxBuilders regardless of body size.

import { describe, expect, it } from "vitest";
import { Building } from "../../../src/operations/building";
import { colonySnap, snapCreeps } from "../../fixtures";

describe("builder workforce", () => {
  const building = new Building("W1N1");

  it("asks for nothing without construction backlog", () => {
    const snap = colonySnap({ constructionProgress: 0, storageEnergy: 200_000 });
    expect(building.desiredCreeps(snap)).toEqual([]);
  });

  // At the 300-capacity default body (1 WORK/creep), 1 WORK per 1k of progress means one creep per 1k.
  it("scales one builder per 1k of work (1 WORK part each at the 300-capacity body)", () => {
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 3_000, storageEnergy: 200_000 }))).toHaveLength(3);
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 5_000, storageEnergy: 200_000 }))).toHaveLength(5);
  });

  // Hard ceiling regardless of how much WORK the backlog calls for.
  it("caps at maxBuilders even when outstanding work asks for more", () => {
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 50_000, storageEnergy: 200_000 }))).toHaveLength(6);
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 8_000, storageEnergy: 0 }))).toHaveLength(6);
  });

  // A bigger body (more WORK per creep) needs fewer creeps to cover the same WORK target.
  it("needs fewer creeps once the body carries more WORK per creep", () => {
    // 1100-capacity builder body carries multiple WORK parts, so 5k of progress (5 WORK) fits in fewer creeps.
    const snap = colonySnap({ constructionProgress: 5_000, storageEnergy: 200_000, energyCapacity: 1100 });
    expect(building.desiredCreeps(snap).length).toBeLessThan(5);
  });

  it("returns nothing once the live builders meet the quota", () => {
    const snap = colonySnap({ constructionProgress: 5_000, storageEnergy: 200_000, creeps: snapCreeps("builder", 5) });

    expect(building.desiredCreeps(snap)).toEqual([]);
  });

  describe("roleTargets (metrics denominator)", () => {
    it("reports the true builder target, matching the quota", () => {
      const snap = colonySnap({ constructionProgress: 5_000, storageEnergy: 200_000 });
      expect(building.roleTargets(snap)).toEqual([{ role: "builder", target: 5 }]);
    });

    it("reports a target of 0 while builders are still alive — census reads this as a surplus", () => {
      // Nothing left to build but two builders remain: desiredCreeps hides this (returns []), roleTargets exposes it.
      const snap = colonySnap({ constructionProgress: 0, storageEnergy: 200_000, creeps: snapCreeps("builder", 2) });
      expect(building.desiredCreeps(snap)).toEqual([]);
      expect(building.roleTargets(snap)).toEqual([{ role: "builder", target: 0 }]);
    });
  });
});
