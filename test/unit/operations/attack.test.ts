// Attack owns one attacker creep aimed at its constructor-supplied targetRoom until that room is seen
// clear of hostiles. Not wired into operationsFor (no colony gets this by default) — constructed
// directly here, same as colonize.test.ts does for Colonize.

import { describe, expect, it } from "vitest";
import { Attack, MAX_ATTACKERS } from "../../../src/operations/attack";
import { ATTACKER_MIN_COST } from "../../../src/behaviors/roles/attacker";
import { colonySnap, snapCreep, visibleRoom } from "../../fixtures";

const attack = (target: string) => new Attack("W1N1", target);

const ATTACKER_AFFORDABLE = { energyCapacity: ATTACKER_MIN_COST };
const requestsByRole = (requests: { memory: { role: string } }[], role: string) => requests.filter(r => r.memory.role === role);

describe("Attack attacker demand", () => {
  it("requests one attacker aimed at the target room", () => {
    const requests = requestsByRole(attack("W2N1").desiredCreeps(colonySnap(ATTACKER_AFFORDABLE)), "attacker");

    expect(requests).toHaveLength(1);
    expect(requests[0].targetRoom).toBe("W2N1");
    // op is named by the TARGET, not the sponsor — see Attack.name's override doc.
    expect(requests[0].memory.op).toBe("attack:W2N1");
    expect(requests[0].memory.attackTargetRoom).toBe("W2N1");
  });

  it("suppresses demand when the home room cannot afford one", () => {
    const snap = colonySnap({ energyCapacity: ATTACKER_MIN_COST - 1 });
    expect(requestsByRole(attack("W2N1").desiredCreeps(snap), "attacker")).toEqual([]);
  });

  it("does not re-request once MAX_ATTACKERS are already owned for this target", () => {
    const snap = colonySnap({
      ...ATTACKER_AFFORDABLE,
      creeps: Array.from({ length: MAX_ATTACKERS }, () =>
        snapCreep("attacker", { memory: { op: "attack:W2N1", attackTargetRoom: "W2N1" } })
      )
    });
    expect(requestsByRole(attack("W2N1").desiredCreeps(snap), "attacker")).toEqual([]);
  });

  it("still requests when a live attacker is aimed at a different target", () => {
    const snap = colonySnap({
      ...ATTACKER_AFFORDABLE,
      creeps: [snapCreep("attacker", { memory: { op: "attack:W3N1", attackTargetRoom: "W3N1" } })]
    });
    expect(requestsByRole(attack("W2N1").desiredCreeps(snap), "attacker")).toHaveLength(1);
  });

  it("still re-requests for an attacker whose op stamp is stale/foreign even though its own attackTargetRoom matches", () => {
    // A creep with an op stamp that doesn't match this instance's name (attack:W2N1) but an
    // attackTargetRoom that does — an inconsistent fixture that can't arise from real spawning today,
    // but proves the attackTargetRoom filter alone isn't what gates re-requesting; owned()'s op-stamp
    // match matters too.
    const snap = colonySnap({
      ...ATTACKER_AFFORDABLE,
      creeps: [snapCreep("attacker", { memory: { op: "attack:W9N9", attackTargetRoom: "W2N1" } })]
    });
    expect(requestsByRole(attack("W2N1").desiredCreeps(snap), "attacker")).toHaveLength(1);
  });

  it("stops requesting once the target room has been seen clear of hostiles", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, visibleRooms: [visibleRoom("W2N1", undefined, 0)] });
    expect(requestsByRole(attack("W2N1").desiredCreeps(snap), "attacker")).toEqual([]);
  });

  it("keeps requesting while the target room is seen with hostiles still present", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, visibleRooms: [visibleRoom("W2N1", undefined, 2)] });
    expect(requestsByRole(attack("W2N1").desiredCreeps(snap), "attacker")).toHaveLength(1);
  });

  // Regression: hostileCount folds in hostile-owned structures (see snapshot/colony.ts's builder), not
  // just FIND_HOSTILE_CREEPS — a room holding nothing but an invader core has 0 hostile creeps but must
  // still count as active, or Attack self-removes the instant it's placed and never sends an attacker.
  it("keeps requesting for a room with a hostile structure but zero hostile creeps (e.g. a lone invader core)", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, visibleRooms: [visibleRoom("W2N1", undefined, 1)] });
    expect(requestsByRole(attack("W2N1").desiredCreeps(snap), "attacker")).toHaveLength(1);
  });

  it("keeps requesting while the target room has never been seen", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, visibleRooms: [] });
    expect(requestsByRole(attack("W2N1").desiredCreeps(snap), "attacker")).toHaveLength(1);
  });
});

describe("Attack removal (intents)", () => {
  it("emits nothing while the target room has never been seen", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, visibleRooms: [] });
    expect(attack("W2N1").intents(snap)).toEqual([]);
  });

  it("emits nothing while the target room is seen with hostiles still present", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, visibleRooms: [visibleRoom("W2N1", undefined, 1)] });
    expect(attack("W2N1").intents(snap)).toEqual([]);
  });

  it("removes the target once the room is seen clear of hostiles", () => {
    const snap = colonySnap({ ...ATTACKER_AFFORDABLE, visibleRooms: [visibleRoom("W2N1", undefined, 0)] });
    expect(attack("W2N1").intents(snap)).toEqual([{ kind: "removeAttackTarget", room: "W1N1", target: "W2N1" }]);
  });
});
