// Ported verbatim from systems/defense.test.ts — the logic did not change, only its owner. Defense
// is all direct action, so every case reads through intents(). Constructs the operation directly and
// hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Defense } from "../../../src/operations/defense";
import { colonySnap, hostileAt, towerAt, woundedAt } from "../../fixtures";

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
});
