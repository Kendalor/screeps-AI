// The quota has two regimes now: pre-storage, a small dedicated squad leads the RCL climb; with
// storage, the ported getMaxUpgraders formula scales on what storage holds. Constructs the operation
// directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import GOAL_JSON from "../../../src/layouts/Base_2.json";
import type { GoalLayout } from "../../../src/layouts/sync";
import type { XY } from "../../../src/lib/geometry";
import { Upgrading } from "../../../src/operations/upgrading";
import { colonySnap, containerAt, dropAt, snapCreeps } from "../../fixtures";

const upgrading = new Upgrading("W1N1");
const upgraderRequests = (over: Parameters<typeof colonySnap>[0]) => upgrading.desiredCreeps(colonySnap(over));

const chebyshev = (a: XY, b: XY): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const storageOffset = (GOAL_JSON as GoalLayout).placements.find(p => p.type === "storage")!;
const storageTileFor = (anchor: XY): XY => ({ x: storageOffset.x + anchor.x, y: storageOffset.y + anchor.y });

describe("Upgrading.desiredCreeps — pre-storage squad", () => {
  it("fields a base squad (one per source) once there is energy to draw from, no surplus", () => {
    // A filled mining container is a source of energy the upgrader role can withdraw from.
    const one = upgraderRequests({
      storageEnergy: 0,
      controllerLevel: 2,
      sources: [{ id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 }],
      containers: [containerAt(21, 10, 500)]
    });
    expect(one).toHaveLength(2); // base 1 + ceil(500/1000)=1

    const two = upgraderRequests({
      storageEnergy: 0,
      controllerLevel: 2,
      sources: [
        { id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 },
        { id: "s2" as Id<Source>, x: 30, y: 40, openTiles: 8 }
      ],
      containers: [containerAt(21, 10, 500)]
    });
    expect(two).toHaveLength(3); // base 2 + ceil(500/1000)=1
  });

  it("also works off ground drops before any container is built", () => {
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 2, drops: [dropAt(20, 10, 200)] })
    ).toHaveLength(2); // base 1 + ceil(200/1000)=1
  });

  it("asks for nothing pre-storage with no container energy and no drops — nothing to withdraw from", () => {
    expect(upgraderRequests({ storageEnergy: 0, controllerLevel: 2, containers: [], drops: [] })).toEqual([]);
  });

  it("is viable from RCL1 — it is what climbs the controller off room start", () => {
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 1, drops: [dropAt(20, 10, 200)] })
    ).toHaveLength(2); // base 1 + ceil(200/1000)=1
  });

  // The point of removing the cap: when energy piles up unspent, add consumers so it does not rot.
  // One extra upgrader per 1k of standing surplus (drops + container), on top of the per-source base.
  it("scales up, uncapped, with the standing energy surplus", () => {
    const oneSource = [{ id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 }];
    // base 1 + ceil(3500/1000)=4 → 5 upgraders to burn down a 3.5k drop pile.
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 2, sources: oneSource, drops: [dropAt(20, 10, 3500)] })
    ).toHaveLength(5);
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

describe("Upgrading.structures — controller container + road", () => {
  const anchor: XY = { x: 25, y: 25 };
  const controller: XY = { x: 25, y: 40 };
  // A room that has just reached the gate: RCL3 with every extension, capacity 800.
  const gated = (over: Parameters<typeof colonySnap>[0] = {}) =>
    colonySnap({ anchor, controller, controllerLevel: 3, energyCapacity: 800, ...over });

  it("claims exactly one container within range 2 of the controller", () => {
    const containers = upgrading.structures(gated()).filter(s => s.type === "container");

    expect(containers).toHaveLength(1);
    expect(chebyshev(containers[0], controller)).toBeLessThanOrEqual(2);
  });

  it("stays in upgrade range: the container is never further than range 3 from the controller", () => {
    const [container] = upgrading.structures(gated()).filter(s => s.type === "container");

    // Range 2 is the target, but the load-bearing property is "an upgrader on it can still upgrade".
    expect(chebyshev(container, controller)).toBeLessThanOrEqual(3);
  });

  it("claims a road linking the container back toward the storage tile", () => {
    const claimed = upgrading.structures(gated());
    const roads = claimed.filter(s => s.type === "road");
    const [container] = claimed.filter(s => s.type === "container");

    expect(roads.length).toBeGreaterThan(0);
    // The road nearest storage is adjacent to where storage will sit; the road nearest the
    // controller is adjacent to the container — i.e. a connected run from storage to the container.
    const storage = storageTileFor(anchor);
    expect(roads.some(r => chebyshev(r, storage) === 1)).toBe(true);
    expect(roads.some(r => chebyshev(r, container) === 1)).toBe(true);
    // The container tile itself is never also claimed as road.
    expect(roads).not.toContainEqual({ x: container.x, y: container.y, type: "road" });
  });

  // Capacity, not level, is the gate: 549 is one short. A room that cannot fund the container asks
  // for nothing, exactly as its creep demand is gated by current state.
  it("withholds the container below the energyCapacity gate", () => {
    expect(upgrading.structures(gated({ energyCapacity: 549 }))).toEqual([]);
  });

  it("claims nothing before an anchor exists", () => {
    expect(upgrading.structures(gated({ anchor: null }))).toEqual([]);
  });

  // Two structures on one tile is not a plan planBuilding can execute.
  it("never claims a tile a sibling already planned", () => {
    const claimed = upgrading.structures(gated());
    // Feed its own claim back as the planned set: nothing new may be claimed on those tiles.
    const planned = claimed.map(c => ({ x: c.x, y: c.y, type: c.type }));
    const second = upgrading.structures(gated(), planned);

    const taken = new Set(planned.map(p => `${p.x},${p.y}`));
    for (const c of second) expect(taken.has(`${c.x},${c.y}`)).toBe(false);
  });
});
