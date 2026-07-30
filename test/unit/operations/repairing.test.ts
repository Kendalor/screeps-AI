// The Repairing operation: dedicated repair creeps for decay a tower can't reach — either because no
// tower exists yet, or the decayed structure sits beyond a tower's efficient repair range.

import { describe, expect, it } from "vitest";
import { Repairing } from "../../../src/operations/repairing";
import { colonySnap, snapCreep, snapCreeps, structureAt, towerAt } from "../../fixtures";

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

  it("wants a repairer for decay in a selected remote room, even with no home decay", () => {
    const snap = colonySnap({
      structures: [],
      remoteStructures: { W2N1: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })] }
    });
    expect(repairing.desiredCreeps(snap)).toHaveLength(1);
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

  describe("intents (cross-room repair target assignment)", () => {
    it("does nothing when no room has any tower-uncovered decay", () => {
      const creep = snapCreep("repair");
      const snap = colonySnap({ structures: [], remoteStructures: {}, creeps: [creep] });
      expect(repairing.intents(snap)).toEqual([]);
    });

    it("assigns an unassigned repairer to the nearest room with uncovered decay", () => {
      const creep = snapCreep("repair");
      const snap = colonySnap({
        structures: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })], // home
        remoteStructures: { W3N1: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })] }, // 2 rooms away
        creeps: [creep]
      });
      expect(repairing.intents(snap)).toEqual([{ kind: "setRepairTargetRoom", creep: creep.id, room: "W1N1" }]);
    });

    it("prefers a nearer remote room's decay over a farther one", () => {
      const creep = snapCreep("repair");
      const snap = colonySnap({
        structures: [],
        remoteStructures: {
          W3N1: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })], // 2 rooms away
          W2N1: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })] // 1 room away
        },
        creeps: [creep]
      });
      expect(repairing.intents(snap)).toEqual([{ kind: "setRepairTargetRoom", creep: creep.id, room: "W2N1" }]);
    });

    it("leaves a repairer's assignment alone while its current room still has uncovered decay", () => {
      const creep = snapCreep("repair", { memory: { repairTargetRoom: "W2N1" } });
      const snap = colonySnap({
        structures: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })], // home, nearer — but repairer already assigned
        remoteStructures: { W2N1: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })] },
        creeps: [creep]
      });
      expect(repairing.intents(snap)).toEqual([]);
    });

    it("reassigns a repairer once its current room's decay is gone", () => {
      const creep = snapCreep("repair", { memory: { repairTargetRoom: "W2N1" } });
      const snap = colonySnap({
        structures: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })], // W2N1's decay cleared
        remoteStructures: {},
        creeps: [creep]
      });
      expect(repairing.intents(snap)).toEqual([{ kind: "setRepairTargetRoom", creep: creep.id, room: "W1N1" }]);
    });

    it("ignores non-repair creeps", () => {
      const builder = snapCreep("builder");
      const snap = colonySnap({
        structures: [structureAt(10, 10, "road", { hits: 400, hitsMax: 1000 })],
        creeps: [builder]
      });
      expect(repairing.intents(snap)).toEqual([]);
    });

    it("does not treat tower-covered home decay as an assignable room", () => {
      const creep = snapCreep("repair");
      const nearDecay = structureAt(12, 10, "road", { hits: 400, hitsMax: 1000 });
      const snap = colonySnap({
        towers: [towerAt(10, 10)],
        structures: [nearDecay],
        remoteStructures: {},
        creeps: [creep]
      });
      expect(repairing.intents(snap)).toEqual([]);
    });
  });
});
