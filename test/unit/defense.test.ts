import { describe, expect, it } from "vitest";
import { planDefense } from "../../src/systems/defense";
import { colony, empire, hostileAt, towerAt, woundedAt } from "../fixtures";

describe("defense planner", () => {
  it("prefers safemode when towerless and invaded", () => {
    const snap = empire(colony({ hostiles: [hostileAt(10, 10)], towers: [], safeModeAvailable: true }));

    expect(planDefense(snap)).toEqual([{ kind: "safeMode", room: "W1N1" }]);
  });

  it("has each tower attack its closest hostile", () => {
    const nearTopLeft = hostileAt(12, 12);
    const nearBottomRight = hostileAt(40, 40);
    const snap = empire(
      colony({
        towers: [towerAt(10, 10, "towerA"), towerAt(38, 38, "towerB")],
        hostiles: [nearTopLeft, nearBottomRight]
      })
    );

    expect(planDefense(snap)).toEqual([
      { kind: "towerAttack", tower: "towerA", target: nearTopLeft.id },
      { kind: "towerAttack", tower: "towerB", target: nearBottomRight.id }
    ]);
  });

  it("heals the closest wounded friendly when no hostiles are present", () => {
    const hurt = woundedAt(15, 15);
    const snap = empire(
      colony({
        towers: [towerAt(10, 10, "towerA")],
        woundedFriendlies: [hurt]
      })
    );

    expect(planDefense(snap)).toEqual([{ kind: "towerHeal", tower: "towerA", target: hurt.id }]);
  });

  it("emits nothing for a quiet, healthy colony", () => {
    const snap = empire(colony({ towers: [towerAt(10, 10)] }));

    expect(planDefense(snap)).toEqual([]);
  });

  it("does not burn safemode when towers can fight instead", () => {
    const hostile = hostileAt(20, 20);
    const snap = empire(
      colony({
        towers: [towerAt(10, 10, "towerA")],
        hostiles: [hostile],
        safeModeAvailable: true
      })
    );

    expect(planDefense(snap)).toEqual([{ kind: "towerAttack", tower: "towerA", target: hostile.id }]);
  });
});
