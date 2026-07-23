// The Building operation: the dedicated builder workforce that services outstanding construction.
// Ported from systems/building.test.ts (and the interim colony/requests.test.ts). The quota formula
// did not change, only its home (now an operation) and its argument (ColonySnapshot).

import { describe, expect, it } from "vitest";
import { Building } from "../../../src/operations/building";
import { colonySnap, snapCreeps } from "../../fixtures";

describe("builder workforce", () => {
  const building = new Building("W1N1");

  it("asks for nothing without construction backlog", () => {
    const snap = colonySnap({ constructionProgress: 0, storageEnergy: 200_000 });
    expect(building.desiredCreeps(snap)).toEqual([]);
  });

  it("scales one builder per 5k of outstanding work, capped at three", () => {
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 3_000 }))).toHaveLength(1);
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 8_000 }))).toHaveLength(2);
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 500_000 }))).toHaveLength(3);
  });

  // With bootstrap's early-game all-rounder gone, builders are how sites get finished from the first
  // one on — the builder role sources its own energy pre-storage, so there is no storage gate.
  it("builds pre-storage, scaling with the backlog", () => {
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 10_000, storageEnergy: 0, controllerLevel: 3 }))).toHaveLength(2);
  });

  it("returns nothing once the live builders meet the quota", () => {
    const snap = colonySnap({ constructionProgress: 8_000, storageEnergy: 200_000, creeps: snapCreeps("builder", 2) });

    expect(building.desiredCreeps(snap)).toEqual([]);
  });
});
