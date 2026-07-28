// Ported verbatim from systems/defense.test.ts — the logic did not change, only its owner. Defense
// is all direct action, so every case reads through intents(). Constructs the operation directly and
// hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Defense } from "../../../src/operations/defense";
import { colonySnap, hostileAt, structureAt, towerAt, woundedAt } from "../../fixtures";

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
});
