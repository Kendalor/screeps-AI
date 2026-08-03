// Attack pools every target listed in colony.attacking behind ONE shared attacker (MAX_ATTACKERS = 1),
// reassigning the same creep to the next open target once its current one clears instead of spawning a
// fresh one per target. Not wired into operationsFor (no colony gets this by default) — constructed
// directly here, same as colonize.test.ts does for Colonize.

import { describe, expect, it } from "vitest";
import { Attack, MAX_ATTACKERS } from "../../../src/operations/attack";
import { ATTACKER_MIN_COST } from "../../../src/behaviors/roles/attacker";
import { colonySnap, snapCreep, visibleRoom } from "../../fixtures";

const attack = new Attack("W1N1");

const ATTACKER_AFFORDABLE = { energyCapacity: ATTACKER_MIN_COST };
const requestsByRole = (requests: { memory: { role: string } }[], role: string) => requests.filter(r => r.memory.role === role);

describe("Attack attacker demand", () => {
  it("requests one attacker aimed at the first queued target", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, attacking: ["W2N1"] });
    const requests = requestsByRole(attack.desiredCreeps(snap), "attacker");

    expect(requests).toHaveLength(1);
    expect(requests[0].targetRoom).toBe("W2N1");
    expect(requests[0].memory.op).toBe("attack:W1N1");
    expect(requests[0].memory.attackTargetRoom).toBe("W2N1");
  });

  it("requests nothing when attacking is empty", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, attacking: [] });
    expect(requestsByRole(attack.desiredCreeps(snap), "attacker")).toEqual([]);
  });

  it("suppresses demand when the home room cannot afford one", () => {
    const snap = colonySnap({ energyCapacity: ATTACKER_MIN_COST - 1, attacking: ["W2N1"] });
    expect(requestsByRole(attack.desiredCreeps(snap), "attacker")).toEqual([]);
  });

  it("does not re-request once MAX_ATTACKERS are already owned, even with more targets queued", () => {
    const snap = colonySnap({
      ...ATTACKER_AFFORDABLE,
      attacking: ["W2N1", "W3N1"],
      creeps: Array.from({ length: MAX_ATTACKERS }, () =>
        snapCreep("attacker", { memory: { op: "attack:W1N1", attackTargetRoom: "W2N1" } })
      )
    });
    expect(requestsByRole(attack.desiredCreeps(snap), "attacker")).toEqual([]);
  });

  it("requests a replacement once every queued target has been seen clear", () => {
    const snap = colonySnap({
      ...ATTACKER_AFFORDABLE,
      attacking: ["W2N1"],
      visibleRooms: [visibleRoom("W2N1", undefined, 0)]
    });
    expect(requestsByRole(attack.desiredCreeps(snap), "attacker")).toEqual([]);
  });

  it("keeps requesting while a queued target still has hostiles", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, attacking: ["W2N1"], visibleRooms: [visibleRoom("W2N1", undefined, 2)] });
    expect(requestsByRole(attack.desiredCreeps(snap), "attacker")).toHaveLength(1);
  });

  // Regression: hostileCount folds in hostile-owned structures (see snapshot/colony.ts's builder), not
  // just FIND_HOSTILE_CREEPS — a room holding nothing but an invader core has 0 hostile creeps but must
  // still count as active, or Attack drops it the instant it's placed and never sends an attacker.
  it("keeps requesting for a target with a hostile structure but zero hostile creeps (e.g. a lone invader core)", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, attacking: ["W2N1"], visibleRooms: [visibleRoom("W2N1", undefined, 1)] });
    expect(requestsByRole(attack.desiredCreeps(snap), "attacker")).toHaveLength(1);
  });

  it("keeps requesting while a queued target has never been seen", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, attacking: ["W2N1"], visibleRooms: [] });
    expect(requestsByRole(attack.desiredCreeps(snap), "attacker")).toHaveLength(1);
  });

  it("aims at the second target once the first is already seen clear", () => {
    const snap = colonySnap({
      ...ATTACKER_AFFORDABLE,
      attacking: ["W2N1", "W3N1"],
      visibleRooms: [visibleRoom("W2N1", undefined, 0)]
    });
    const requests = requestsByRole(attack.desiredCreeps(snap), "attacker");
    expect(requests[0].targetRoom).toBe("W3N1");
  });
});

describe("Attack removal + reassignment (intents)", () => {
  it("emits nothing while the only queued target has never been seen", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, attacking: ["W2N1"], visibleRooms: [] });
    expect(attack.intents(snap)).toEqual([]);
  });

  it("emits nothing while the only queued target still has hostiles and the attacker is already aimed there", () => {
    const snap = colonySnap({
      ...ATTACKER_AFFORDABLE,
      attacking: ["W2N1"],
      visibleRooms: [visibleRoom("W2N1", undefined, 1)],
      creeps: [snapCreep("attacker", { memory: { op: "attack:W1N1", attackTargetRoom: "W2N1" } })]
    });
    expect(attack.intents(snap)).toEqual([]);
  });

  it("removes a target once it's seen clear of hostiles", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, attacking: ["W2N1"], visibleRooms: [visibleRoom("W2N1", undefined, 0)] });
    expect(attack.intents(snap)).toEqual([{ kind: "removeAttackTarget", room: "W1N1", target: "W2N1" }]);
  });

  it("reassigns the surviving attacker to the next open target once its current one clears", () => {
    const snap = colonySnap({
      ...ATTACKER_AFFORDABLE,
      attacking: ["W2N1", "W3N1"],
      visibleRooms: [visibleRoom("W2N1", undefined, 0), visibleRoom("W3N1", undefined, 1)],
      creeps: [snapCreep("attacker", { id: "atk1" as Id<Creep>, memory: { op: "attack:W1N1", attackTargetRoom: "W2N1" } })]
    });
    expect(attack.intents(snap)).toEqual([
      { kind: "removeAttackTarget", room: "W1N1", target: "W2N1" },
      { kind: "setAttackTargetRoom", creep: "atk1", room: "W3N1" }
    ]);
  });

  it("leaves an attacker already aimed at an open target alone", () => {
    const snap = colonySnap({
      ...ATTACKER_AFFORDABLE,
      attacking: ["W2N1", "W3N1"],
      visibleRooms: [visibleRoom("W2N1", undefined, 2)],
      creeps: [snapCreep("attacker", { memory: { op: "attack:W1N1", attackTargetRoom: "W2N1" } })]
    });
    expect(attack.intents(snap)).toEqual([]);
  });
});
