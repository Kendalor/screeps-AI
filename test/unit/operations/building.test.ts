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

  // Post-storage, one builder per 5k of work (a builder withdraws a full load per trip), uncapped.
  it("scales one builder per 5k of work with storage, uncapped", () => {
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 3_000, storageEnergy: 200_000 }))).toHaveLength(1);
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 8_000, storageEnergy: 200_000 }))).toHaveLength(2);
    // Cap removed — 50k of work wants 10 builders; the arbiter's affordability guard is the real limit.
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 50_000, storageEnergy: 200_000 }))).toHaveLength(10);
  });

  // Pre-storage, builders are tiny (a 50-energy load per trip) so many are needed to finish a site
  // before every other role drains the drops — one per 1.5k of work, so an extension (3k) pulls two,
  // two extension sites (6k) pull four. Completing them is what lifts the room past 300 capacity.
  it("fields many small builders pre-storage to finish sites before storage exists", () => {
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 3_000, storageEnergy: 0 }))).toHaveLength(2);
    expect(building.desiredCreeps(colonySnap({ constructionProgress: 6_000, storageEnergy: 0, controllerLevel: 2 }))).toHaveLength(4);
  });

  it("returns nothing once the live builders meet the quota", () => {
    const snap = colonySnap({ constructionProgress: 8_000, storageEnergy: 200_000, creeps: snapCreeps("builder", 2) });

    expect(building.desiredCreeps(snap)).toEqual([]);
  });
});
