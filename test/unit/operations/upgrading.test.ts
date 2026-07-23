// The quota has two regimes now: pre-storage, a small dedicated squad leads the RCL climb; with
// storage, the ported getMaxUpgraders formula scales on what storage holds. Constructs the operation
// directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Upgrading } from "../../../src/operations/upgrading";
import { colonySnap, containerAt, dropAt, snapCreeps } from "../../fixtures";

const upgrading = new Upgrading("W1N1");
const upgraderRequests = (over: Parameters<typeof colonySnap>[0]) => upgrading.desiredCreeps(colonySnap(over));

describe("Upgrading.desiredCreeps — pre-storage squad", () => {
  it("fields a base squad (one per source) once there is energy to draw from, no surplus", () => {
    // A filled mining container is a source of energy the upgrader role can withdraw from.
    const one = upgraderRequests({
      storageEnergy: 0,
      controllerLevel: 2,
      sources: [{ id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 }],
      containers: [containerAt(21, 10, 500)]
    });
    expect(one).toHaveLength(1);

    const two = upgraderRequests({
      storageEnergy: 0,
      controllerLevel: 2,
      sources: [
        { id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 },
        { id: "s2" as Id<Source>, x: 30, y: 40, openTiles: 8 }
      ],
      containers: [containerAt(21, 10, 500)]
    });
    expect(two).toHaveLength(2);
  });

  it("also works off ground drops before any container is built", () => {
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 2, drops: [dropAt(20, 10, 200)] })
    ).toHaveLength(1);
  });

  it("asks for nothing pre-storage with no container energy and no drops — nothing to withdraw from", () => {
    expect(upgraderRequests({ storageEnergy: 0, controllerLevel: 2, containers: [], drops: [] })).toEqual([]);
  });

  it("is viable from RCL1 — it is what climbs the controller off room start", () => {
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 1, drops: [dropAt(20, 10, 200)] })
    ).toHaveLength(1);
  });

  // The point of removing the cap: when energy piles up unspent, add consumers so it does not rot.
  // One extra upgrader per 1k of standing surplus (drops + container), on top of the per-source base.
  it("scales up, uncapped, with the standing energy surplus", () => {
    const oneSource = [{ id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 }];
    // base 1 + floor(3500/1000)=3 → 4 upgraders to burn down a 3.5k drop pile.
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 2, sources: oneSource, drops: [dropAt(20, 10, 3500)] })
    ).toHaveLength(4);
    // A big enough surplus asks for many — no cap.
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 2, sources: oneSource, drops: [dropAt(20, 10, 9000)] })
    ).toHaveLength(10);
  });

  // Container energy counts toward the surplus just like ground drops.
  it("counts container energy toward the surplus", () => {
    const oneSource = [{ id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 }];
    expect(
      upgraderRequests({
        storageEnergy: 0,
        controllerLevel: 2,
        constructionProgress: 0,
        sources: oneSource,
        containers: [containerAt(21, 10, 2000)]
      })
    ).toHaveLength(3); // base 1 + floor(2000/1000)=2
  });

  // While there is construction to do, upgrading holds at the floor so builders win the energy —
  // completing an extension compounds, and a scaled-up upgrader squad was measured to starve it.
  it("holds at one upgrader while construction is outstanding, despite a surplus", () => {
    const twoSources = [
      { id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 },
      { id: "s2" as Id<Source>, x: 30, y: 40, openTiles: 8 }
    ];
    expect(
      upgraderRequests({
        storageEnergy: 0,
        controllerLevel: 2,
        constructionProgress: 6_000, // extensions to build
        sources: twoSources,
        drops: [dropAt(20, 10, 5000)] // big surplus, but building comes first
      })
    ).toHaveLength(1);
  });
});

describe("Upgrading.desiredCreeps — with storage (ported getMaxUpgraders)", () => {
  it("with storage, scales with stored energy instead of room energy (ported getMaxUpgraders)", () => {
    expect(upgraderRequests({ storageEnergy: 100_000, controllerLevel: 4 })).toHaveLength(0);
    expect(upgraderRequests({ storageEnergy: 140_000, controllerLevel: 4 })).toHaveLength(1);
    expect(upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6 })).toHaveLength(4);
  });

  it("returns nothing once the live upgraders meet the quota", () => {
    expect(
      upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6, creeps: snapCreeps("upgrader", 4) })
    ).toEqual([]);
  });

  it("asks only for the shortfall when some upgraders are already alive", () => {
    expect(
      upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6, creeps: snapCreeps("upgrader", 3) })
    ).toHaveLength(1);
  });

  it("stamps its own op name on every request", () => {
    const [request] = upgraderRequests({ storageEnergy: 140_000, controllerLevel: 4 });

    expect(request.memory).toMatchObject({ role: "upgrader", home: "W1N1", op: "upgrading:W1N1" });
  });
});
