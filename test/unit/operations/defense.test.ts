// Ported verbatim from systems/defense.test.ts — the logic did not change, only its owner. Defense
// is all direct action, so every case reads through intents(). Constructs the operation directly and
// hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Defense } from "../../../src/operations/defense";
import { colonySnap, hostileAt, remoteSourceAt, snapCreep, structureAt, towerAt, woundedAt } from "../../fixtures";

const defense = new Defense("W1N1");

describe("Defense.intents", () => {
  it("prefers safemode when towerless and invaded", () => {
    const snap = colonySnap({ hostiles: [hostileAt(10, 10)], towers: [], safeModeAvailable: true });

    expect(defense.intents(snap)).toEqual([{ kind: "safeMode", room: "W1N1" }]);
  });

  it("has each tower attack its closest hostile", () => {
    const nearTopLeft = hostileAt(12, 12);
    const nearBottomRight = hostileAt(40, 40);
    const snap = colonySnap({
      towers: [towerAt(10, 10, "towerA"), towerAt(38, 38, "towerB")],
      hostiles: [nearTopLeft, nearBottomRight]
    });

    expect(defense.intents(snap)).toEqual([
      { kind: "towerAttack", tower: "towerA", target: nearTopLeft.id },
      { kind: "towerAttack", tower: "towerB", target: nearBottomRight.id }
    ]);
  });

  it("heals the closest wounded friendly when no hostiles are present", () => {
    const hurt = woundedAt(15, 15);
    const snap = colonySnap({ towers: [towerAt(10, 10, "towerA")], woundedFriendlies: [hurt] });

    expect(defense.intents(snap)).toEqual([{ kind: "towerHeal", tower: "towerA", target: hurt.id }]);
  });

  it("emits nothing for a quiet, healthy colony", () => {
    const snap = colonySnap({ towers: [towerAt(10, 10)] });

    expect(defense.intents(snap)).toEqual([]);
  });

  it("does not burn safemode when towers can fight instead", () => {
    const hostile = hostileAt(20, 20);
    const snap = colonySnap({
      towers: [towerAt(10, 10, "towerA")],
      hostiles: [hostile],
      safeModeAvailable: true
    });

    expect(defense.intents(snap)).toEqual([{ kind: "towerAttack", tower: "towerA", target: hostile.id }]);
  });

  it("repairs the closest decayed structure within range 6 when nothing is hostile or wounded", () => {
    const decayed = structureAt(12, 10, "road", { hits: 400, hitsMax: 1000 });
    const snap = colonySnap({ towers: [towerAt(10, 10, "towerA")], structures: [decayed] });

    expect(defense.intents(snap)).toEqual([{ kind: "towerRepair", tower: "towerA", target: decayed.id }]);
  });

  it("prefers healing a wounded friendly over repairing a structure", () => {
    const hurt = woundedAt(11, 10);
    const decayed = structureAt(12, 10, "road", { hits: 400, hitsMax: 1000 });
    const snap = colonySnap({
      towers: [towerAt(10, 10, "towerA")],
      woundedFriendlies: [hurt],
      structures: [decayed]
    });

    expect(defense.intents(snap)).toEqual([{ kind: "towerHeal", tower: "towerA", target: hurt.id }]);
  });

  it("does not repair a structure beyond range 6, leaving it for a repairer creep", () => {
    const tooFar = structureAt(20, 10, "road", { hits: 400, hitsMax: 1000 });
    const snap = colonySnap({ towers: [towerAt(10, 10, "towerA")], structures: [tooFar] });

    expect(defense.intents(snap)).toEqual([]);
  });

  it("ignores structures above the repair floor and structure types excluded from repair (walls/ramparts)", () => {
    const healthy = structureAt(12, 10, "road", { hits: 999, hitsMax: 1000 });
    const decayedWall = structureAt(11, 10, "constructedWall", { hits: 1, hitsMax: 300_000_000 });
    const snap = colonySnap({ towers: [towerAt(10, 10, "towerA")], structures: [healthy, decayedWall] });

    expect(defense.intents(snap)).toEqual([]);
  });

  it("holds fire on a border hostile it can't one-shot and that isn't threatening a building", () => {
    // Range 40 (beyond TOWER_FALLOFF_RANGE) caps tower damage at its 150hp minimum, well under this
    // hostile's health, so the shot wouldn't kill it.
    const onBorder = { ...hostileAt(0, 25), hits: 1000, hitsMax: 1000 };
    const snap = colonySnap({ towers: [towerAt(40, 25, "towerA")], hostiles: [onBorder] });

    expect(defense.intents(snap)).toEqual([]);
  });

  it("still shoots a border hostile it can one-shot", () => {
    const onBorder = { ...hostileAt(0, 10, "weak"), hits: 1 };
    const snap = colonySnap({ towers: [towerAt(2, 10, "towerA")], hostiles: [onBorder] });

    expect(defense.intents(snap)).toEqual([{ kind: "towerAttack", tower: "towerA", target: "weak" }]);
  });

  it("still shoots a border hostile standing next to a friendly building even without a kill shot", () => {
    const onBorder = { ...hostileAt(0, 25), hits: 1000, hitsMax: 1000 };
    const building = structureAt(0, 24, "extension");
    const snap = colonySnap({
      towers: [towerAt(40, 25, "towerA")],
      hostiles: [onBorder],
      structures: [building]
    });

    expect(defense.intents(snap)).toEqual([{ kind: "towerAttack", tower: "towerA", target: onBorder.id }]);
  });

  it("treats a non-border hostile as always worth shooting regardless of kill odds", () => {
    const interior = hostileAt(25, 25);
    const snap = colonySnap({ towers: [towerAt(10, 10, "towerA")], hostiles: [interior] });

    expect(defense.intents(snap)).toEqual([{ kind: "towerAttack", tower: "towerA", target: interior.id }]);
  });
});

describe("Defense.desiredCreeps", () => {
  it("requests nothing for a quiet colony", () => {
    const snap = colonySnap({ hostiles: [] });
    expect(defense.desiredCreeps(snap)).toEqual([]);
  });

  it("requests one defender for a single invader", () => {
    const snap = colonySnap({ hostiles: [hostileAt(10, 10)] });
    const requests = defense.desiredCreeps(snap);
    expect(requests).toHaveLength(1);
    expect(requests[0].memory.role).toBe("defender");
    expect(requests[0].memory.op).toBe("defense:W1N1");
  });

  it("scales requested defenders with hostile count, capped at the ceiling", () => {
    const snap = colonySnap({ hostiles: [hostileAt(1, 1), hostileAt(2, 2), hostileAt(3, 3)] });
    // 3 hostiles at 2-per-defender rounds up to 2 requested.
    expect(defense.desiredCreeps(snap)).toHaveLength(2);

    const swarmed = colonySnap({
      hostiles: Array.from({ length: 20 }, (_, i) => hostileAt(i, i))
    });
    expect(defense.desiredCreeps(swarmed)).toHaveLength(3);
  });

  it("stops requesting once enough defenders are already alive", () => {
    const snap = colonySnap({
      hostiles: [hostileAt(10, 10)],
      creeps: [snapCreep("defender", { memory: { op: "defense:W1N1" } })]
    });
    expect(defense.desiredCreeps(snap)).toEqual([]);
  });

  it("requests a defender for an invaded remote even with a quiet home room", () => {
    const snap = colonySnap({
      hostiles: [],
      remoteSources: [remoteSourceAt(10, 10, "W2N1", { danger: 1 })]
    });
    const requests = defense.desiredCreeps(snap);
    expect(requests).toHaveLength(1);
    expect(requests[0].memory.role).toBe("defender");
  });

  it("does not request for a remote with no danger", () => {
    const snap = colonySnap({ hostiles: [], remoteSources: [remoteSourceAt(10, 10, "W2N1", { danger: 0 })] });
    expect(defense.desiredCreeps(snap)).toEqual([]);
  });

  // Reservation and hostile-creep danger are deliberately separate signals (see mining.ts/reservation.ts's
  // reservedBy gate): a room reserved by the Invader NPC with no live hostile creeps has nothing for a
  // combat creep to fight, so Defense must not spawn/dispatch a defender at it.
  it("does not request a defender for a remote that's reserved but not dangerous", () => {
    const snap = colonySnap({
      hostiles: [],
      remoteSources: [remoteSourceAt(10, 10, "W2N1", { danger: 0, reservedBy: "Invader" })]
    });
    expect(defense.desiredCreeps(snap)).toEqual([]);
  });
});

describe("Defense remote dispatch (defendTargetRoom)", () => {
  it("sends a defender's target room to the invaded remote when the home room is quiet", () => {
    const snap = colonySnap({
      hostiles: [],
      remoteSources: [remoteSourceAt(10, 10, "W2N1", { danger: 1 })],
      creeps: [snapCreep("defender", { memory: { op: "defense:W1N1" } })]
    });
    const intents = defense.intents(snap);
    expect(intents).toContainEqual({ kind: "setDefendTargetRoom", creep: expect.any(String), room: "W2N1" });
  });

  it("prefers the home room over a remote when both are invaded", () => {
    const snap = colonySnap({
      hostiles: [hostileAt(10, 10)],
      remoteSources: [remoteSourceAt(10, 10, "W2N1", { danger: 1 })],
      creeps: [snapCreep("defender", { memory: { op: "defense:W1N1" } })]
    });
    const intents = defense.intents(snap);
    expect(intents).toContainEqual({ kind: "setDefendTargetRoom", creep: expect.any(String), room: "W1N1" });
  });

  it("leaves an already-correctly-assigned defender alone", () => {
    const snap = colonySnap({
      hostiles: [],
      remoteSources: [remoteSourceAt(10, 10, "W2N1", { danger: 1 })],
      creeps: [snapCreep("defender", { memory: { op: "defense:W1N1", defendTargetRoom: "W2N1" } })]
    });
    const intents = defense.intents(snap);
    expect(intents.some(i => i.kind === "setDefendTargetRoom")).toBe(false);
  });

  it("reassigns a defender once its current room's danger has cleared", () => {
    const snap = colonySnap({
      hostiles: [hostileAt(5, 5)],
      remoteSources: [remoteSourceAt(10, 10, "W2N1", { danger: 0 })],
      creeps: [snapCreep("defender", { memory: { op: "defense:W1N1", defendTargetRoom: "W2N1" } })]
    });
    const intents = defense.intents(snap);
    expect(intents).toContainEqual({ kind: "setDefendTargetRoom", creep: expect.any(String), room: "W1N1" });
  });

  it("emits no reassignment once no room is invaded at all", () => {
    const snap = colonySnap({
      hostiles: [],
      remoteSources: [remoteSourceAt(10, 10, "W2N1", { danger: 0 })],
      creeps: [snapCreep("defender", { memory: { op: "defense:W1N1", defendTargetRoom: "W2N1" } })]
    });
    const intents = defense.intents(snap);
    expect(intents.some(i => i.kind === "setDefendTargetRoom")).toBe(false);
  });
});
