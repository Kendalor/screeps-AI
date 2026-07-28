// The Repairing operation: dedicated repair creeps for decay a tower can't reach — either because no
// tower exists yet, or the decayed structure sits beyond a tower's efficient repair range.

import { describe, expect, it } from "vitest";
import { Repairing } from "../../../src/operations/repairing";
import { colonySnap, snapCreeps, structureAt, towerAt } from "../../fixtures";

const repairing = new Repairing("W1N1");

describe("Repairing.desiredCreeps", () => {
  it("asks for nothing when nothing is decayed", () => {
    const snap = colonySnap({ structures: [structureAt(10, 10, "road", { hits: 1000, hitsMax: 1000 })] });
    expect(repairing.desiredCreeps(snap)).toEqual([]);
  });

  it("wants a repairer for decay when no tower exists", () => {
    const snap = colonySnap({ towers: [], structures: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })] });
    expect(repairing.desiredCreeps(snap)).toHaveLength(1);
  });

  it("wants a repairer for decay beyond every tower's range, even with towers present", () => {
    const farDecay = structureAt(30, 30, "road", { hits: 400, hitsMax: 1000 });
    const snap = colonySnap({ towers: [towerAt(10, 10)], structures: [farDecay] });
    expect(repairing.desiredCreeps(snap)).toHaveLength(1);
  });

  it("asks for nothing when a tower already covers the only decay", () => {
    const nearDecay = structureAt(12, 10, "road", { hits: 400, hitsMax: 1000 });
    const snap = colonySnap({ towers: [towerAt(10, 10)], structures: [nearDecay] });
    expect(repairing.desiredCreeps(snap)).toEqual([]);
  });

  it("returns nothing once the live repairer meets the quota", () => {
    const snap = colonySnap({
      towers: [],
      structures: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })],
      creeps: snapCreeps("repair", 1)
    });
    expect(repairing.desiredCreeps(snap)).toEqual([]);
  });

  describe("roleTargets (metrics denominator)", () => {
    it("reports a target of 0 once towers take over, exposing surplus repairers", () => {
      const nearDecay = structureAt(12, 10, "road", { hits: 400, hitsMax: 1000 });
      const snap = colonySnap({
        towers: [towerAt(10, 10)],
        structures: [nearDecay],
        creeps: snapCreeps("repair", 1)
      });
      expect(repairing.desiredCreeps(snap)).toEqual([]);
      expect(repairing.roleTargets(snap)).toEqual([{ role: "repair", target: 0 }]);
    });
  });
});
