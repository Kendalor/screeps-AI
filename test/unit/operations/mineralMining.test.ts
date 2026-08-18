// MineralMining's structure-claim, creep-request, and (implicit, via absence) intent-emission behavior —
// same seam as mining.test.ts, hand-built ColonySnapshot fixtures, no Game mock, no Colony.

import { beforeEach, describe, expect, it } from "vitest";
import type { XY } from "../../../src/lib/geometry";
import { MineralMining } from "../../../src/operations/mineralMining";
import { findPath, resetFindPathCacheForTests, type FindPath } from "../../../src/construction/planner";
import { colonySnap, mineralAt, openTerrain, snapCreep } from "../../fixtures";
import { stubPathFinderSingleRoom } from "../../constants";
import type { ColonySnapshot } from "../../../src/snapshot/types";

const mineralMining = new MineralMining("W1N1");

beforeEach(() => {
  stubPathFinderSingleRoom();
  resetFindPathCacheForTests();
});

const findPathFor = (snap: ColonySnapshot): FindPath => (from, to, range, opts) => findPath(snap, from, to, range, opts);

function expectedRoute(anchor: XY, mineral: XY, rcl = 6) {
  const snap = colonySnap({ anchor, mineral: mineralAt(mineral.x, mineral.y), controllerLevel: rcl, terrain: openTerrain() });
  const anchorPos = new RoomPosition(anchor.x, anchor.y, snap.name);
  const mineralPos = new RoomPosition(mineral.x, mineral.y, snap.name);
  return findPathFor(snap)(anchorPos, mineralPos, 1);
}

const expectedSpot = (anchor: XY, mineral: XY, rcl = 6) => expectedRoute(anchor, mineral, rcl).structurePos;

describe("MineralMining on a colony with nothing to mine", () => {
  it("wants nothing through any channel", () => {
    const snap = colonySnap({ mineral: undefined, anchor: { x: 25, y: 25 }, controllerLevel: 8 });

    expect(mineralMining.desiredCreeps(snap)).toEqual([]);
    expect(mineralMining.structures(snap, findPathFor(snap))).toEqual([]);
    expect(mineralMining.intents(snap)).toEqual([]);
  });
});

describe("MineralMining.structures", () => {
  it("claims an extractor on the mineral's own tile", () => {
    const anchor = { x: 10, y: 10 };
    const mineral = { x: 20, y: 10 };
    const snap = colonySnap({ anchor, mineral: mineralAt(mineral.x, mineral.y), controllerLevel: 6 });

    expect(mineralMining.structures(snap, findPathFor(snap))).toContainEqual({ x: mineral.x, y: mineral.y, type: "extractor" });
  });

  it("claims a container on the last road tile next to the mineral", () => {
    const anchor = { x: 10, y: 10 };
    const mineral = { x: 20, y: 10 };
    const snap = colonySnap({ anchor, mineral: mineralAt(mineral.x, mineral.y), controllerLevel: 6 });

    const spot = expectedSpot(anchor, mineral);
    expect(mineralMining.structures(snap, findPathFor(snap))).toContainEqual({ x: spot.x, y: spot.y, type: "container" });
  });

  // The real engine requirement is controller level, not an energy-capacity proxy — an extractor already
  // has an RCL gate to check against (see mineralMining.ts's EXTRACTOR_RCL doc).
  it("withholds extractor and container below RCL6", () => {
    const snap = colonySnap({
      anchor: { x: 10, y: 10 },
      mineral: mineralAt(20, 10),
      controllerLevel: 5,
      energyCapacity: 100000
    });

    expect(mineralMining.structures(snap, findPathFor(snap))).toEqual([]);
  });

  it("claims the road leading to its container, not just the container", () => {
    const anchor = { x: 10, y: 10 };
    const mineral = { x: 20, y: 10 };
    const snap = colonySnap({ anchor, mineral: mineralAt(mineral.x, mineral.y), controllerLevel: 6 });

    const route = expectedRoute(anchor, mineral);
    const roads = mineralMining.structures(snap, findPathFor(snap)).filter(s => s.type === "road");

    expect(roads.length).toBeGreaterThan(0);
    const onRoute = new Set(route.path.map(p => `${p.x},${p.y}`));
    for (const r of roads) expect(onRoute.has(`${r.x},${r.y}`)).toBe(true);
    expect(roads).not.toContainEqual({ x: route.structurePos.x, y: route.structurePos.y, type: "road" });
  });

  it("claims road tiles mineral-outward, nearest the container first", () => {
    const anchor = { x: 10, y: 10 };
    const mineral = { x: 20, y: 10 };
    const snap = colonySnap({ anchor, mineral: mineralAt(mineral.x, mineral.y), controllerLevel: 6 });

    const roads = mineralMining.structures(snap, findPathFor(snap)).filter(s => s.type === "road");
    expect(roads.length).toBeGreaterThan(1);

    const toMineral = (p: { x: number; y: number }) => Math.max(Math.abs(p.x - mineral.x), Math.abs(p.y - mineral.y));
    expect(toMineral(roads[0])).toBeLessThan(toMineral(roads[roads.length - 1]));
  });
});

describe("MineralMining.desiredCreeps", () => {
  const anchor = { x: 10, y: 10 };
  const built = mineralAt(20, 10, { extractorId: "extractor1" as Id<StructureExtractor>, containerId: "container1" as Id<StructureContainer> });

  it("requests no mineralMiner before RCL6 (structures don't exist yet)", () => {
    const snap = colonySnap({ anchor, mineral: mineralAt(20, 10), controllerLevel: 5 });
    expect(mineralMining.desiredCreeps(snap)).toEqual([]);
  });

  it("requests a mineralMiner once extractor and container both exist", () => {
    const snap = colonySnap({ anchor, mineral: built, controllerLevel: 6 });
    const requests = mineralMining.desiredCreeps(snap);
    expect(requests).toHaveLength(1);
    expect(requests[0].memory.role).toBe("mineralMiner");
  });

  it("withholds a mineralMiner while the extractor is claimed but not yet built", () => {
    const snap = colonySnap({ anchor, mineral: mineralAt(20, 10, { containerId: "container1" as Id<StructureContainer> }), controllerLevel: 6 });
    expect(mineralMining.desiredCreeps(snap)).toEqual([]);
  });

  it("withholds a mineralMiner while the deposit is fully depleted", () => {
    const snap = colonySnap({ anchor, mineral: { ...built, mineralAmount: 0 }, controllerLevel: 6 });
    expect(mineralMining.desiredCreeps(snap)).toEqual([]);
  });

  // The gate reads the cached mineralMemory.regeneratesAt (see intents()'s doc), not the live snapshot's
  // ticksToRegeneration directly — that cache is what keeps the gate correct once the deposit stops
  // being visible every tick (a future remote/keeper-room mineral). A tick's own intents() call is what
  // populates that cache in the first place; desiredCreeps() only ever reads it.
  it("withholds a mineralMiner while the cached regen deadline is still in the future", () => {
    const snap = colonySnap({ anchor, mineral: built, controllerLevel: 6, tick: 1000, mineralMemory: { regeneratesAt: 1500 } });
    expect(mineralMining.desiredCreeps(snap)).toEqual([]);
  });

  it("requests a mineralMiner once the cached regen deadline has passed", () => {
    const snap = colonySnap({ anchor, mineral: built, controllerLevel: 6, tick: 1500, mineralMemory: { regeneratesAt: 1500 } });
    expect(mineralMining.desiredCreeps(snap)).toHaveLength(1);
  });

  // Deliberate M0 design choice, not an oversight — see this milestone's Implementation Decisions:
  // storage/terminal fullness is explicitly NOT a gate on mineral mining.
  it("requests a mineralMiner even while storage is nearly full", () => {
    const snap = colonySnap({ anchor, mineral: built, controllerLevel: 6, storageEnergy: 990000, storageCapacity: 1000000 });
    expect(mineralMining.desiredCreeps(snap)).toHaveLength(1);
  });

  it("requests no more once a mineralMiner is already alive", () => {
    const snap = colonySnap({
      anchor,
      mineral: built,
      controllerLevel: 6,
      creeps: [snapCreep("mineralMiner", { memory: { op: mineralMining.name } })]
    });
    expect(mineralMining.desiredCreeps(snap)).toEqual([]);
  });
});

describe("MineralMining.intents — regen caching", () => {
  it("caches a newly-depleted deposit's regen deadline", () => {
    const snap = colonySnap({ mineral: mineralAt(20, 10, { mineralAmount: 0, ticksToRegeneration: 500 }), tick: 1000 });
    expect(mineralMining.intents(snap)).toEqual([{ kind: "recordMineralRegen", room: "W1N1", regeneratesAt: 1500 }]);
  });

  it("does not re-emit once the cached deadline already matches", () => {
    const snap = colonySnap({
      mineral: mineralAt(20, 10, { mineralAmount: 0, ticksToRegeneration: 500 }),
      tick: 1000,
      mineralMemory: { regeneratesAt: 1500 }
    });
    expect(mineralMining.intents(snap)).toEqual([]);
  });

  it("clears the cached deadline once regen completes with vision", () => {
    const snap = colonySnap({
      mineral: mineralAt(20, 10, { mineralAmount: 500, ticksToRegeneration: 0 }),
      tick: 1500,
      mineralMemory: { regeneratesAt: 1500 }
    });
    expect(mineralMining.intents(snap)).toEqual([{ kind: "recordMineralRegen", room: "W1N1", regeneratesAt: undefined }]);
  });

  it("emits nothing without a mineral in the room", () => {
    expect(mineralMining.intents(colonySnap({ mineral: undefined }))).toEqual([]);
  });

  it("emits nothing while a never-depleted deposit stays never-depleted", () => {
    const snap = colonySnap({ mineral: mineralAt(20, 10, { mineralAmount: 50000, ticksToRegeneration: 0 }) });
    expect(mineralMining.intents(snap)).toEqual([]);
  });
});
