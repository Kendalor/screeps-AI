import { beforeEach, describe, expect, it } from "vitest";
import { advanceRoute, canCoFire, firstRunnableStep, nextStep, runStep, type CreepState } from "../../src/behaviors/interpreter";
import type { Step } from "../../src/behaviors/types";
import { clearTiles, stubTile } from "../constants";
import { stubGame } from "../helpers";

beforeEach(() => clearTiles());

// A three-step loop: gather from a source, then spend on spawn, then upgrade.
const STEPS: Step[] = [
  { do: "harvest", from: { find: "source" } },
  { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } },
  { do: "upgrade" }
];

function state(over: Partial<CreepState> = {}): CreepState {
  return { step: 0, free: 50, used: 0, targetGone: false, didAct: false, ...over };
}

describe("advanceRoute", () => {
  it("aims at the first room while the creep is still at the start", () => {
    // Standing in the origin (not yet in rooms[0]) — head for rooms[0], cursor unchanged.
    const route = { rooms: ["W1N2", "W1N3", "W1N4"], index: 0 };
    expect(advanceRoute(route, "W1N1")).toBe("W1N2");
    expect(route.index).toBe(0);
  });

  it("advances the cursor once the creep enters the room at the cursor", () => {
    const route = { rooms: ["W1N2", "W1N3", "W1N4"], index: 0 };
    // Now in W1N2 (rooms[0]) — cursor steps to 1, aim at the next room.
    expect(advanceRoute(route, "W1N2")).toBe("W1N3");
    expect(route.index).toBe(1);
  });

  it("clamps at the final room so an overrun still aims at the destination", () => {
    const route = { rooms: ["W1N2", "W1N3", "W1N4"], index: 2 };
    // In the last room already — cursor does not run past the end, aim stays on the destination.
    expect(advanceRoute(route, "W1N4")).toBe("W1N4");
    expect(route.index).toBe(2);
  });
});

// Per docs.screeps.com/simultaneous-actions.html: harvest/build/repair/upgrade share one WORK-part
// pipeline (mutually exclusive), while transfer/withdraw/pickup are each an independent CARRY-part
// pipeline — so a miner can harvest and transfer in the same tick, but not harvest and build.
describe("canCoFire", () => {
  it("allows harvest alongside transfer — different pipelines (WORK vs CARRY)", () => {
    expect(canCoFire({ do: "harvest", from: { find: "source" } }, { do: "transfer", to: { find: "source" } })).toBe(
      true
    );
  });

  it("allows transfer alongside withdraw — each CARRY method is its own independent pipeline", () => {
    expect(canCoFire({ do: "transfer", to: { find: "source" } }, { do: "withdraw", from: { find: "source" } })).toBe(
      true
    );
  });

  it("blocks harvest alongside build — both share the WORK pipeline", () => {
    expect(canCoFire({ do: "harvest", from: { find: "source" } }, { do: "build" })).toBe(false);
  });

  it("blocks build alongside upgrade — both share the WORK pipeline", () => {
    expect(canCoFire({ do: "build" }, { do: "upgrade" })).toBe(false);
  });

  it("allows a move step alongside a work step — movement never blocks or is blocked", () => {
    expect(canCoFire({ do: "moveToRoom" }, { do: "harvest", from: { find: "source" } })).toBe(true);
  });
});

describe("interpreter step advancement", () => {
  it("stays on a gathering step while the creep still has free capacity", () => {
    expect(nextStep(STEPS, state({ step: 0, free: 50, used: 0 }))).toBe(0);
  });

  it("advances off a gathering step once the store is full", () => {
    expect(nextStep(STEPS, state({ step: 0, free: 0, used: 50 }))).toBe(1);
  });

  it("stays on a spending step while the creep still carries resources", () => {
    expect(nextStep(STEPS, state({ step: 1, free: 25, used: 25 }))).toBe(1);
  });

  it("advances off a spending step once the store is empty", () => {
    expect(nextStep(STEPS, state({ step: 1, free: 50, used: 0 }))).toBe(2);
  });

  it("wraps from the last step back to the first", () => {
    expect(nextStep(STEPS, state({ step: 2, free: 50, used: 0 }))).toBe(0);
  });

  it("advances immediately when the locked target has vanished", () => {
    expect(nextStep(STEPS, state({ step: 0, free: 50, used: 0, targetGone: true }))).toBe(1);
  });
});

// A `when: "empty"` gate makes a step a no-op while the creep still carries anything, so nextStep
// treats it as already complete and cycles past it — the mechanism that keeps a loaded hauler
// delivering (returning to an earlier spend step) instead of gathering more the moment a sink fills.
describe("when: empty gate", () => {
  // deliver STORAGE, then gather CONTAINER only-when-empty — a two-step loop mimicking the hauler.
  const GATED: Step[] = [
    { do: "transfer", to: { find: "structure", type: STRUCTURE_STORAGE, where: "notFull" } },
    { do: "withdraw", when: "empty", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } }
  ];

  it("skips a when:empty gather while the creep still carries energy", () => {
    // Landed on the gather step with a partial load: it is complete, so the loop wraps back to deliver.
    expect(firstRunnableStep(GATED, 1, { free: 25, used: 25 })).toBe(0);
    expect(nextStep(GATED, state({ step: 1, free: 25, used: 25 }))).toBe(0);
  });

  it("runs the when:empty gather once the creep is fully empty", () => {
    expect(firstRunnableStep(GATED, 1, { free: 50, used: 0 })).toBe(1);
    expect(nextStep(GATED, state({ step: 1, free: 50, used: 0 }))).toBe(1);
  });
});

// A `oneShot` spend step completes the instant it acts, regardless of remaining store — unlike a
// plain spend step (complete only at used===0). This is for a creep target that keeps re-validating
// as a legal sink every tick (an actively-upgrading creep drains its own carry, so it's forever
// "notFull"): without oneShot the hauler would lock on and dump its entire load into one consumer,
// never re-checking a structure sink upstream that freed up mid-trip.
describe("oneShot gate", () => {
  const ONE_SHOT: Step[] = [
    { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
    { do: "transfer", to: { find: "creep", role: "upgrader", where: "notFull" }, oneShot: true }
  ];

  it("stays on a oneShot step the tick it has not yet acted", () => {
    expect(nextStep(ONE_SHOT, state({ step: 1, free: 0, used: 50, didAct: false }))).toBe(1);
  });

  it("advances off a oneShot step the instant it acts, even while still carrying energy", () => {
    expect(nextStep(ONE_SHOT, state({ step: 1, free: 25, used: 25, didAct: true }))).toBe(0);
  });

  it("a plain spend step (no oneShot) ignores didAct and stays until the store is empty", () => {
    expect(nextStep(ONE_SHOT, state({ step: 0, free: 25, used: 25, didAct: true }))).toBe(0);
  });
});

// Lets the dispatch skip a step that's already complete (e.g. landing on "upgrade"
// with an empty store right after a transfer) instead of wasting a tick on a no-op.
describe("firstRunnableStep", () => {
  it("stays put when the current step already has something to do", () => {
    expect(firstRunnableStep(STEPS, 1, { free: 25, used: 25 })).toBe(1);
  });

  it("skips a spend step landed on with an empty store straight to the next gather step", () => {
    expect(firstRunnableStep(STEPS, 2, { free: 50, used: 0 })).toBe(0);
  });

  it("skips a full gather step to the following spend step", () => {
    expect(firstRunnableStep(STEPS, 0, { free: 0, used: 50 })).toBe(1);
  });

  it("returns the starting step when nothing in the loop is runnable", () => {
    expect(firstRunnableStep(STEPS, 0, { free: 0, used: 0 })).toBe(0);
  });
});

// runStep returns the id of the target it acted on so the dispatch can store it as
// the creep's lock for next tick; undefined drives CreepState.targetGone.
function siteCreep(over: Partial<{ built: object[]; range: boolean }> = {}): Creep {
  const acted: string[] = [];
  const creep = {
    actedOn: acted,
    pos: {
      x: 5,
      y: 5,
      findClosestByPath: (list: object[]) => list[0] ?? null,
      inRangeTo: () => over.range ?? true
    },
    room: { find: () => over.built ?? [] },
    build: (t: { id: string }) => acted.push(t.id),
    travelTo: () => undefined
  };
  return creep as unknown as Creep;
}

function site(id: string): object {
  return { id, pos: { x: 10, y: 10 }, progress: 0, progressTotal: 100 };
}

// A build-in-range creep standing on a road, with a free non-road tile in range, to exercise the
// doNotBlockRoads nudge threaded through runStep. Uses the shared RoomPosition/stubTile fixtures
// (unlike the plain-object pos mocks elsewhere in this file) since stepOffRoad walks real terrain/lookFor.
function roadSiteCreep(): { creep: Creep; traveled: RoomPosition[] } {
  const traveled: RoomPosition[] = [];
  const ROOM = "W1N1";
  const s = { id: "siteA", pos: new RoomPosition(5, 5, ROOM), progress: 0, progressTotal: 100 };
  stubTile(ROOM, 5, 5, { structure: [{ structureType: STRUCTURE_ROAD }] });
  // stepOffRoad only evacuates when a road-using ("mover") creep is nearby to want the tile.
  stubTile(ROOM, 6, 6, { creep: [{ id: "mover", memory: { role: "hauler" } }] });

  const creep = {
    pos: new RoomPosition(5, 5, ROOM),
    room: { find: () => [s] },
    build: () => undefined,
    travelTo: (p: RoomPosition) => traveled.push(p)
  };
  return { creep: creep as unknown as Creep, traveled };
}

// A full creep must not "act" on a withdraw/pickup step even when a valid target resolves (e.g. a
// non-full storage) — otherwise the dispatch loop in creeps.ts locks onto it, travels there, and calls
// withdraw() every tick even though it returns ERR_FULL and moves zero energy: the creep just shuttles
// between structures forever without ever delivering. Symmetrically for transfer on an empty creep.
describe("capacity guards on withdraw/pickup/transfer", () => {
  function storeCreep(free: number, used: number): Creep {
    return {
      store: { getFreeCapacity: () => free, getUsedCapacity: () => used },
      pos: { inRangeTo: () => true, findClosestByPath: (list: object[]) => list[0] ?? null },
      room: { find: () => [{ id: "target1", structureType: STRUCTURE_STORAGE, store: { getFreeCapacity: () => 100, getUsedCapacity: () => 100 } }] },
      withdraw: () => ERR_FULL,
      pickup: () => ERR_FULL,
      transfer: () => ERR_NOT_ENOUGH_RESOURCES,
      travelTo: () => undefined
    } as unknown as Creep;
  }

  it("does not act on a withdraw step when the creep has no free capacity", () => {
    const creep = storeCreep(0, 50);
    const result = runStep(creep, { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } });
    expect(result).toEqual({ acted: false, didAct: false });
  });

  it("does not act on a pickup step when the creep has no free capacity", () => {
    const creep = storeCreep(0, 50);
    const result = runStep(creep, { do: "pickup", from: { find: "dropped" } });
    expect(result).toEqual({ acted: false, didAct: false });
  });

  it("does not act on a transfer step when the creep has nothing to give", () => {
    const creep = storeCreep(50, 0);
    const result = runStep(creep, { do: "transfer", to: { find: "structure", type: STRUCTURE_STORAGE, where: "notFull" } });
    expect(result).toEqual({ acted: false, didAct: false });
  });

  it("does not act on a gather step when the creep has no free capacity", () => {
    const creep = storeCreep(0, 50);
    const result = runStep(creep, { do: "gather", from: { find: "dropped" } });
    expect(result).toEqual({ acted: false, didAct: false });
  });
});

// "gather" covers a "from" spec that may resolve to either a dropped Resource (pickup-shaped) or a
// store-holder like a structure/tombstone (withdraw-shaped) — e.g. energySourceGroup(). Unlike
// "withdraw"/"pickup", which each always call one fixed API, "gather" must pick the right one per
// resolved target so a single mixed-kind "any" spec works in one step.
describe("gather step verb dispatch", () => {
  function gatherCreep(target: object, calls: { withdraw: number; pickup: number }): Creep {
    return {
      store: { getFreeCapacity: () => 50, getUsedCapacity: () => 0 },
      pos: { inRangeTo: () => true, findClosestByPath: (list: object[]) => list[0] ?? null },
      room: { find: () => [target] },
      memory: { task: { step: 0 } },
      withdraw: () => {
        calls.withdraw++;
        return OK;
      },
      pickup: () => {
        calls.pickup++;
        return OK;
      },
      travelTo: () => undefined
    } as unknown as Creep;
  }

  it("calls pickup when the resolved target is a dropped resource", () => {
    const drop = { id: "drop1", pos: { x: 5, y: 5 }, amount: 100, resourceType: RESOURCE_ENERGY };
    stubGame({ objects: { drop1: drop } });
    const calls = { withdraw: 0, pickup: 0 };

    const result = runStep(gatherCreep(drop, calls), { do: "gather", from: { find: "dropped" } });

    expect(calls).toEqual({ withdraw: 0, pickup: 1 });
    expect(result).toEqual({ acted: true, didAct: true, target: "drop1" });
  });

  it("calls withdraw when the resolved target is a store-holder (structure or tombstone)", () => {
    const container = {
      id: "cont1",
      pos: { x: 5, y: 5 },
      structureType: STRUCTURE_CONTAINER,
      store: { getFreeCapacity: () => 50, getUsedCapacity: () => 100 }
    };
    stubGame({ objects: { cont1: container } });
    const calls = { withdraw: 0, pickup: 0 };

    const result = runStep(gatherCreep(container, calls), {
      do: "gather",
      from: { find: "structure", type: [STRUCTURE_CONTAINER], where: "hasEnergy" }
    });

    expect(calls).toEqual({ withdraw: 1, pickup: 0 });
    expect(result).toEqual({ acted: true, didAct: true, target: "cont1" });
  });

  it("dispatches correctly within a single mixed any-group spec (energySourceGroup-shaped)", () => {
    const drop = { id: "drop1", pos: { x: 5, y: 5 }, amount: 100, resourceType: RESOURCE_ENERGY };
    stubGame({ objects: { drop1: drop } });
    const calls = { withdraw: 0, pickup: 0 };
    const creep = {
      store: { getFreeCapacity: () => 50, getUsedCapacity: () => 0 },
      pos: { inRangeTo: () => true, findClosestByPath: (list: object[]) => list[0] ?? null },
      room: { find: (k: FindConstant) => (k === FIND_DROPPED_RESOURCES ? [drop] : []) },
      memory: { task: { step: 0 } },
      withdraw: () => {
        calls.withdraw++;
        return OK;
      },
      pickup: () => {
        calls.pickup++;
        return OK;
      },
      travelTo: () => undefined
    } as unknown as Creep;

    const result = runStep(creep, {
      do: "gather",
      from: {
        find: "any",
        of: [
          { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy" },
          { find: "dropped" },
          { find: "tombstone" }
        ]
      }
    });

    expect(calls).toEqual({ withdraw: 0, pickup: 1 });
    expect(result).toEqual({ acted: true, didAct: true, target: "drop1" });
  });
});

describe("runStep target reporting", () => {
  it("reports the id of the target it acted on", () => {
    const s = site("siteA");
    stubGame({ objects: { siteA: s } });

    expect(runStep(siteCreep({ built: [s] }), { do: "build" })).toEqual({ acted: true, didAct: true, target: "siteA" });
  });

  it("reports no action when no target resolves", () => {
    stubGame({ objects: {} });

    expect(runStep(siteCreep({ built: [] }), { do: "build" })).toEqual({ acted: false, didAct: false });
  });

  it("acts on the locked target rather than the nearest one", () => {
    const near = site("near");
    const locked = site("locked");
    stubGame({ objects: { near, locked } });
    const creep = siteCreep({ built: [near, locked] });

    const used = runStep(creep, { do: "build" }, "locked" as Id<_HasId>);

    expect(used).toEqual({ acted: true, didAct: true, target: "locked" });
    expect((creep as unknown as { actedOn: string[] }).actedOn).toEqual(["locked"]);
  });
});

describe("runStep doNotBlockRoads", () => {
  it("steps off a road after building, when doNotBlockRoads is requested", () => {
    const { creep, traveled } = roadSiteCreep();
    stubGame({ objects: {} });

    const result = runStep(creep, { do: "build" }, undefined, true, { doNotBlockRoads: true });

    expect(result.didAct).toBe(true);
    expect(traveled).toHaveLength(1);
    expect(traveled[0].isEqualTo(new RoomPosition(5, 5, "W1N1"))).toBe(false);
  });

  it("does not nudge off a road when doNotBlockRoads is not requested", () => {
    const { creep, traveled } = roadSiteCreep();
    stubGame({ objects: {} });

    runStep(creep, { do: "build" });

    expect(traveled).toHaveLength(0);
  });
});

// A container sits on the source's mining tile: a drop miner should stand on it directly so overflow
// lands in the container without a separate transfer step, rather than parking on any other adjacent tile.
function harvestCreep(over: {
  pos: { x: number; y: number };
  containerPos?: { x: number; y: number };
  containerOccupant?: string; // creep id currently on the container tile, if any
} & Partial<{ inRange: boolean }>): { creep: Creep; harvested: string[]; traveled: { x: number; y: number }[] } {
  const harvested: string[] = [];
  const traveled: { x: number; y: number }[] = [];
  const HARVEST_RANGE = 1;
  const containerPos = over.containerPos;

  const source = {
    id: "source1",
    energy: 3000,
    room: { getTerrain: () => ({ get: () => 0 }) },
    pos: {
      x: 25,
      y: 25,
      findInRange: (_type: unknown, _range: number, opts: { filter: (s: { structureType: string }) => boolean }) => {
        if (!containerPos) return [];
        const container = { structureType: STRUCTURE_CONTAINER, id: "container1", pos: makePos(containerPos) };
        return opts.filter(container) ? [container] : [];
      }
    }
  };

  function makePos(p: { x: number; y: number }) {
    return {
      x: p.x,
      y: p.y,
      lookFor: (_look: unknown) => (over.containerOccupant ? [{ id: over.containerOccupant }] : []),
      isEqualTo: (other: { x: number; y: number }) => other.x === p.x && other.y === p.y
    };
  }

  const creepPos = {
    x: over.pos.x,
    y: over.pos.y,
    findClosestByPath: (list: object[]) => list[0] ?? null,
    inRangeTo: (p: { x: number; y: number }, range: number) =>
      Math.max(Math.abs(p.x - over.pos.x), Math.abs(p.y - over.pos.y)) <= range,
    isEqualTo: (other: { x: number; y: number }) => other.x === over.pos.x && other.y === over.pos.y
  };
  void HARVEST_RANGE;

  const creep = {
    id: "me",
    pos: creepPos,
    room: { find: () => [source] },
    memory: { task: { step: 0 } },
    store: { getFreeCapacity: () => 50 }, // room to harvest into
    harvest: (t: { id: string }) => harvested.push(t.id),
    travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
  };
  return { creep: creep as unknown as Creep, harvested, traveled };
}

describe("harvest step: standing on a source container", () => {
  it("heads for the container tile, not just any tile adjacent to the source, when out of range", () => {
    const { creep, traveled, harvested } = harvestCreep({
      pos: { x: 20, y: 20 },
      containerPos: { x: 25, y: 26 }
    });

    const result = runStep(creep, { do: "harvest", from: { find: "source" } });

    expect(traveled).toEqual([{ x: 25, y: 26 }]);
    expect(harvested).toEqual([]);
    expect(result).toEqual({ acted: true, didAct: false, target: "source1" });
  });

  it("harvests and steps onto the free container tile in the same tick it comes into source range", () => {
    // Already in range 1 of the source but standing one tile off the container itself.
    const { creep, traveled, harvested } = harvestCreep({
      pos: { x: 25, y: 26 },
      containerPos: { x: 26, y: 26 }
    });

    const result = runStep(creep, { do: "harvest", from: { find: "source" } });

    expect(harvested).toEqual(["source1"]);
    expect(traveled).toEqual([{ x: 26, y: 26 }]);
    expect(result).toEqual({ acted: true, didAct: true, target: "source1" });
  });

  it("stays put and keeps harvesting once parked on the container, without re-pathing every tick", () => {
    const { creep, traveled, harvested } = harvestCreep({
      pos: { x: 26, y: 26 },
      containerPos: { x: 26, y: 26 }
    });

    const result = runStep(creep, { do: "harvest", from: { find: "source" } });

    expect(harvested).toEqual(["source1"]);
    expect(traveled).toEqual([]); // no travelTo call once already on the target tile
    expect(result).toEqual({ acted: true, didAct: true, target: "source1" });
  });

  it("falls back to plain range-1 harvesting when another creep already holds the container tile", () => {
    const { creep, traveled, harvested } = harvestCreep({
      pos: { x: 25, y: 26 },
      containerPos: { x: 26, y: 26 },
      containerOccupant: "otherMiner"
    });

    const result = runStep(creep, { do: "harvest", from: { find: "source" } });

    // Already in range of the source itself, so it harvests without moving toward the occupied container.
    expect(harvested).toEqual(["source1"]);
    expect(traveled).toEqual([]);
    expect(result).toEqual({ acted: true, didAct: true, target: "source1" });
  });

  it("still walks toward (and eventually harvests from) the source when there is no container at all", () => {
    const { creep, traveled, harvested } = runStepNoContainer();
    expect(traveled).toEqual([{ x: 25, y: 25 }]);
    expect(harvested).toEqual([]);
  });

  it("keeps harvesting even when the creep's store is full — overflow drops to the ground/container", () => {
    // A container miner whose CARRY has filled (because the container is full) must not stop mining:
    // the engine spills the surplus, and it resumes topping up the container the moment space frees.
    // Only an empty source idles a miner, and that's the engine's ERR_NOT_ENOUGH_RESOURCES, not our guard.
    const { creep, traveled, harvested } = harvestCreep({
      pos: { x: 26, y: 26 },
      containerPos: { x: 26, y: 26 }
    });
    (creep as unknown as { store: { getFreeCapacity: () => number } }).store.getFreeCapacity = () => 0;

    const result = runStep(creep, { do: "harvest", from: { find: "source" } });

    expect(harvested).toEqual(["source1"]);
    expect(traveled).toEqual([]); // already parked on the container tile, no re-path
    expect(result).toEqual({ acted: true, didAct: true, target: "source1" });
  });
});

function runStepNoContainer(): { creep: Creep; traveled: { x: number; y: number }[]; harvested: string[] } {
  const { creep, traveled, harvested } = harvestCreep({ pos: { x: 20, y: 20 } });
  runStep(creep, { do: "harvest", from: { find: "source" } });
  return { creep, traveled, harvested };
}

// An upgrader in range keeps upgrading every tick but should draw closer to the controller — onto the
// free controller container when one exists, otherwise in against the controller — rather than parking
// at the far edge of upgrade range.
function upgradeCreep(over: {
  pos: { x: number; y: number };
  containerPos?: { x: number; y: number };
  containerOccupant?: string; // creep id currently on the container tile, if any
}): { creep: Creep; upgraded: string[]; traveled: { x: number; y: number }[] } {
  const upgraded: string[] = [];
  const traveled: { x: number; y: number }[] = [];
  const containerPos = over.containerPos;

  function cheb(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  const controllerPos = {
    x: 25,
    y: 25,
    findInRange: (_type: unknown, range: number, opts: { filter: (s: { structureType: string }) => boolean }) => {
      if (!containerPos) return [];
      const container = { structureType: STRUCTURE_CONTAINER, id: "container1", pos: makePos(containerPos) };
      return cheb(containerPos, { x: 25, y: 25 }) <= range && opts.filter(container) ? [container] : [];
    },
    inRangeTo: (p: { x: number; y: number }, range: number) => cheb(p, { x: 25, y: 25 }) <= range
  };

  function makePos(p: { x: number; y: number }) {
    return {
      x: p.x,
      y: p.y,
      lookFor: (_look: unknown) => (over.containerOccupant ? [{ id: over.containerOccupant }] : []),
      isEqualTo: (other: { x: number; y: number }) => other.x === p.x && other.y === p.y
    };
  }

  const controller = { id: "controller1", level: 2, pos: controllerPos };

  const creepPos = {
    x: over.pos.x,
    y: over.pos.y,
    inRangeTo: (p: { x: number; y: number }, range: number) => cheb(p, over.pos) <= range,
    isEqualTo: (other: { x: number; y: number }) => other.x === over.pos.x && other.y === over.pos.y
  };

  const creep = {
    id: "me",
    pos: creepPos,
    room: { controller },
    memory: { task: { step: 0 } },
    store: { getUsedCapacity: () => 50 },
    upgradeController: (t: { id: string }) => upgraded.push(t.id),
    travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
  };
  return { creep: creep as unknown as Creep, upgraded, traveled };
}

describe("upgrade step: drawing closer to the controller", () => {
  it("walks to within upgrade range when out of range, without upgrading yet", () => {
    const { creep, traveled, upgraded } = upgradeCreep({ pos: { x: 10, y: 10 } });

    const result = runStep(creep, { do: "upgrade" });

    expect(upgraded).toEqual([]);
    expect(traveled).toEqual([{ x: 25, y: 25 }]);
    expect(result).toEqual({ acted: true, didAct: false, target: "controller1" });
  });

  it("upgrades and steps onto the free controller container in the same tick", () => {
    // In range 3 of the controller but not on the container tile.
    const { creep, traveled, upgraded } = upgradeCreep({
      pos: { x: 25, y: 28 },
      containerPos: { x: 25, y: 26 }
    });

    const result = runStep(creep, { do: "upgrade" });

    expect(upgraded).toEqual(["controller1"]);
    expect(traveled).toEqual([{ x: 25, y: 26 }]);
    expect(result).toEqual({ acted: true, didAct: true, target: "controller1" });
  });

  it("stays put and keeps upgrading once parked on the controller container", () => {
    const { creep, traveled, upgraded } = upgradeCreep({
      pos: { x: 25, y: 26 },
      containerPos: { x: 25, y: 26 }
    });

    const result = runStep(creep, { do: "upgrade" });

    expect(upgraded).toEqual(["controller1"]);
    expect(traveled).toEqual([]); // already on the container tile, no re-path
    expect(result).toEqual({ acted: true, didAct: true, target: "controller1" });
  });

  it("bunches in against the controller when there is no container, staying in upgrade range", () => {
    // In range 3 but not adjacent — should upgrade and close to range 1.
    const { creep, traveled, upgraded } = upgradeCreep({ pos: { x: 25, y: 28 } });

    const result = runStep(creep, { do: "upgrade" });

    expect(upgraded).toEqual(["controller1"]);
    expect(traveled).toEqual([{ x: 25, y: 25 }]); // travelTo controller with range 1
    expect(result).toEqual({ acted: true, didAct: true, target: "controller1" });
  });

  it("upgrades without re-pathing once already adjacent to a controller that has no container", () => {
    const { creep, traveled, upgraded } = upgradeCreep({ pos: { x: 25, y: 26 } });

    const result = runStep(creep, { do: "upgrade" });

    expect(upgraded).toEqual(["controller1"]);
    expect(traveled).toEqual([]);
    expect(result).toEqual({ acted: true, didAct: true, target: "controller1" });
  });

  it("falls back to plain in-range upgrading when another creep holds the container tile", () => {
    // Container occupied and creep already adjacent to the controller: upgrade in place, no re-path.
    const { creep, traveled, upgraded } = upgradeCreep({
      pos: { x: 25, y: 26 },
      containerPos: { x: 25, y: 27 },
      containerOccupant: "otherUpgrader"
    });

    const result = runStep(creep, { do: "upgrade" });

    expect(upgraded).toEqual(["controller1"]);
    expect(traveled).toEqual([]);
    expect(result).toEqual({ acted: true, didAct: true, target: "controller1" });
  });
});

// Uses the shared RoomPosition/stubTile fixtures (unlike upgradeCreep's plain-object mocks above) since
// stepOffRoad needs real terrain/lookFor to pick a candidate tile.
function upgradeRoadCreep(): { creep: Creep; traveled: RoomPosition[] } {
  const traveled: RoomPosition[] = [];
  const ROOM = "W1N1";
  const controller = { id: "controller1", level: 2, pos: new RoomPosition(25, 25, ROOM) };
  // Already adjacent to the controller, standing on a road, no container anywhere nearby.
  stubTile(ROOM, 25, 26, { structure: [{ structureType: STRUCTURE_ROAD }] });
  // stepOffRoad only evacuates when a road-using ("mover") creep is nearby to want the tile.
  stubTile(ROOM, 24, 24, { creep: [{ id: "mover", memory: { role: "hauler" } }] });

  const creep = {
    id: "me",
    pos: new RoomPosition(25, 26, ROOM),
    room: { controller },
    memory: { task: { step: 0 } },
    store: { getUsedCapacity: () => 50 },
    upgradeController: () => undefined,
    travelTo: (p: RoomPosition) => traveled.push(p)
  };
  return { creep: creep as unknown as Creep, traveled };
}

describe("upgrade step: doNotBlockRoads", () => {
  it("steps off a road after upgrading when requested and no container claims the tile", () => {
    const { creep, traveled } = upgradeRoadCreep();

    const result = runStep(creep, { do: "upgrade" }, undefined, true, { doNotBlockRoads: true });

    expect(result).toEqual({ acted: true, didAct: true, target: "controller1" });
    expect(traveled).toHaveLength(1);
    expect(traveled[0].isEqualTo(new RoomPosition(25, 26, "W1N1"))).toBe(false);
  });

  it("does not nudge off a road when doNotBlockRoads is not requested", () => {
    const { creep, traveled } = upgradeRoadCreep();

    runStep(creep, { do: "upgrade" });

    expect(traveled).toHaveLength(0);
  });
});

// A remote miner is spawned at home with memory.targetRoom set to its source's room and a stored route.
// moveToRoom { to: "targetRoom" } walks it there; only once it has arrived do the harvest steps engage.
describe("moveToRoom to a creep's targetRoom", () => {
  function roamer(
    room: string,
    targetRoom: string,
    route?: { dest: string; rooms: string[]; index: number },
    pos: { x: number; y: number } = { x: 25, y: 25 } // interior by default — see the border-specific test below
  ) {
    const traveled: { x: number; y: number; room: string }[] = [];
    const creep = {
      room: { name: room },
      pos,
      memory: { targetRoom, route },
      travelTo: (p: { x: number; y: number; roomName: string }) => traveled.push({ x: p.x, y: p.y, room: p.roomName })
    };
    return { creep: creep as unknown as Creep, traveled };
  }

  it("travels toward the target room while outside it", () => {
    const { creep, traveled } = roamer("W1N1", "W2N1");
    const result = runStep(creep, { do: "moveToRoom", to: "targetRoom" });
    expect(result.acted).toBe(true);
    expect(traveled).toEqual([{ x: 25, y: 25, room: "W2N1" }]);
  });

  it("no-ops (advances past) once standing in the target room", () => {
    const { creep, traveled } = roamer("W2N1", "W2N1");
    const result = runStep(creep, { do: "moveToRoom", to: "targetRoom" });
    expect(result).toEqual({ acted: false, didAct: false });
    expect(traveled).toEqual([]);
  });

  it("keeps traveling if standing in the target room but still on its border tile", () => {
    // room.name already equals targetRoom, but the creep is still sitting exactly on the edge (x=0) — not
    // genuinely arrived. Reporting complete here (and never calling travelTo again) is what let a squad
    // member oscillate across a room border forever: the engine nudges a creep that doesn't explicitly
    // move off an edge tile back into the room it came from, so it re-enters next tick and repeats.
    const { creep, traveled } = roamer("W2N1", "W2N1", undefined, { x: 0, y: 25 });
    const result = runStep(creep, { do: "moveToRoom", to: "targetRoom" });
    expect(result.acted).toBe(true);
    expect(traveled).toEqual([{ x: 25, y: 25, room: "W2N1" }]);
  });

  it("follows the stored route's next room rather than jumping to the destination", () => {
    // Two rooms out: the next hop is W2N1, not the final W3N1.
    const route = { dest: "W3N1", rooms: ["W2N1", "W3N1"], index: 0 };
    const { creep, traveled } = roamer("W1N1", "W3N1", route);
    runStep(creep, { do: "moveToRoom", to: "targetRoom" });
    expect(traveled).toEqual([{ x: 25, y: 25, room: "W2N1" }]);
  });
});

// moveToPos (drain's rally step, ADR 0007 follow-up): moves toward a concrete TILE read from memory,
// refreshed every tick by the owning operation — replaces moveToRoom+attackTargetRoom for drain squad
// members specifically, because a room-name destination let two stragglers each converging on "whichever
// room the OTHER one currently stands in" chase each other back and forth across a border forever
// (confirmed live: two drain healers swapping W5N3<->W6N3 every tick, one-tick out of phase).
describe("moveToPos", () => {
  function positioned(pos?: { x: number; y: number; room: string }) {
    const traveled: { x: number; y: number; room: string }[] = [];
    const creep = {
      memory: { drainRallyPos: pos },
      travelTo: (p: RoomPosition) => traveled.push({ x: p.x, y: p.y, room: p.roomName })
    };
    return { creep: creep as unknown as Creep, traveled };
  }

  it("travels toward the memory-stored tile", () => {
    const { creep, traveled } = positioned({ x: 30, y: 12, room: "W2N1" });
    const result = runStep(creep, { do: "moveToPos", to: "drainRallyPos" });
    expect(result.acted).toBe(true);
    expect(traveled).toEqual([{ x: 30, y: 12, room: "W2N1" }]);
  });

  it("is a no-op when the field is unset — nothing to rally toward yet", () => {
    const { creep, traveled } = positioned(undefined);
    const result = runStep(creep, { do: "moveToPos", to: "drainRallyPos" });
    expect(result).toEqual({ acted: false, didAct: false });
    expect(traveled).toEqual([]);
  });
});

// Regression: Traveler's own useFindRoute heuristic (roomDistance>2) is recomputed fresh from the
// creep's CURRENT position on every travelTo call, so a long avoidDanger trip can silently fall into a
// blind PathFinder.search (no routeCallback, no danger-routing at all) partway through, once the
// remaining hop count looks short — confirmed live on shard0 as a scout oscillating forever between two
// rooms near a hostile-owned room it was supposed to be routed around. Forcing useFindRoute:true whenever
// avoidDanger is set closes that gap regardless of how close the creep currently is to its destination.
describe("moveToRoom forces useFindRoute for avoidDanger steps", () => {
  function roamerWithOptions(room: string, targetRoom: string) {
    const options: unknown[] = [];
    const creep = {
      room: { name: room },
      memory: { targetRoom, home: room },
      travelTo: (_p: unknown, opts?: unknown) => {
        options.push(opts);
        return OK;
      }
    };
    return { creep: creep as unknown as Creep, options };
  }

  it("passes useFindRoute:true when avoidDanger is set", () => {
    const { creep, options } = roamerWithOptions("W1N1", "W2N1");
    runStep(creep, { do: "moveToRoom", to: "targetRoom", avoidDanger: true });
    expect((options[0] as { useFindRoute?: boolean }).useFindRoute).toBe(true);
  });

  it("leaves useFindRoute unset when avoidDanger is not set", () => {
    const { creep, options } = roamerWithOptions("W1N1", "W2N1");
    runStep(creep, { do: "moveToRoom", to: "targetRoom" });
    expect((options[0] as { useFindRoute?: boolean }).useFindRoute).toBeUndefined();
  });
});

// A scout that fails to path into its assigned room (Traveler's travelTo comes back ERR_NO_PATH — a real
// PathFinder search at the border with the scout's own vision, e.g. the shared border is walled solid by
// another player) records that failure on the destination's ScoutInfo so dangerRouteCost stops offering
// it as a transit hop for other routes (see schema.ts's noPathFrom doc). Game.map.findRoute/
// scoutCandidatesAround can never detect this on their own since neither sees constructed walls.
describe("moveToRoom records noPathFrom on a scout's travelTo failure", () => {
  function scoutAt(travelResult: number | undefined, scouted?: { noPathFrom?: Record<string, number> }) {
    const creep = {
      room: { name: "W1N1" },
      memory: { home: "W1N1", scoutTarget: "W2N1" },
      travelTo: () => travelResult
    };
    (globalThis as { Memory: { rooms?: Record<string, { scouted?: unknown }> } }).Memory.rooms = {
      W2N1: { scouted }
    };
    return creep as unknown as Creep;
  }

  beforeEach(() => stubGame({ time: 12345 }));

  it("writes noPathFrom keyed by the scout's home when travelTo fails", () => {
    const scouted: { noPathFrom?: Record<string, number> } = {};
    const creep = scoutAt(ERR_NO_PATH, scouted);
    runStep(creep, { do: "moveToRoom", to: "scoutTarget" });
    expect(scouted.noPathFrom).toEqual({ W1N1: 12345 });
  });

  it("does not write noPathFrom when travelTo succeeds", () => {
    const scouted: { noPathFrom?: Record<string, number> } = {};
    const creep = scoutAt(OK, scouted);
    runStep(creep, { do: "moveToRoom", to: "scoutTarget" });
    expect(scouted.noPathFrom).toBeUndefined();
  });

  it("is a no-op when the destination has no ScoutInfo on record yet", () => {
    const creep = scoutAt(ERR_NO_PATH, undefined);
    expect(() => runStep(creep, { do: "moveToRoom", to: "scoutTarget" })).not.toThrow();
  });
});

// A claimer reserves the controller of the room it stands in. reserveController is range 1, like upgrade.
describe("reserve step", () => {
  function claimerAt(inRange: boolean) {
    const reserved: string[] = [];
    const traveled: { x: number; y: number }[] = [];
    const controller = { id: "ctrl1", pos: { x: 40, y: 40 } };
    const creep = {
      pos: {
        inRangeTo: () => inRange,
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      room: { controller },
      reserveController: (c: { id: string }) => reserved.push(c.id),
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
    };
    return { creep: creep as unknown as Creep, reserved, traveled };
  }

  it("reserves the controller when in range", () => {
    const { creep, reserved } = claimerAt(true);
    const result = runStep(creep, { do: "reserve" });
    expect(reserved).toEqual(["ctrl1"]);
    expect(result.didAct).toBe(true);
  });

  it("travels to the controller when out of range instead of reserving", () => {
    const { creep, reserved, traveled } = claimerAt(false);
    const result = runStep(creep, { do: "reserve" });
    expect(reserved).toEqual([]);
    expect(traveled).toEqual([{ x: 40, y: 40 }]);
    expect(result.didAct).toBe(false);
  });
});

// A colonizer claims the controller of the room it stands in. claimController is range 1, like reserve.
// Unlike reserve, a failed call can never self-resolve (GCL cap, room already owned) — claimStep must
// report didAct:false on anything but OK, or oneShot would falsely "complete" a rejected claim.
describe("claim step", () => {
  // A failed claim logs (log.ts reads Game.time) — every other describe in this file needs no Game at
  // all, so this is scoped here rather than stubbed globally for the whole suite.
  beforeEach(() => stubGame());

  function colonizerAt(inRange: boolean, claimResult: ScreepsReturnCode = OK) {
    const claimed: string[] = [];
    const traveled: { x: number; y: number }[] = [];
    let suicided = false;
    const controller = { id: "ctrl1", pos: { x: 40, y: 40 } };
    const creep = {
      name: "colonizer1",
      memory: {},
      pos: {
        inRangeTo: () => inRange,
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      room: { name: "W2N2", controller },
      claimController: (c: { id: string }) => {
        claimed.push(c.id);
        return claimResult;
      },
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y }),
      suicide: () => {
        suicided = true;
        return OK;
      }
    };
    return { creep: creep as unknown as Creep, claimed, traveled, suicided: () => suicided };
  }

  it("claims the controller when in range and reports didAct:true on success", () => {
    const { creep, claimed } = colonizerAt(true);
    const result = runStep(creep, { do: "claim" });
    expect(claimed).toEqual(["ctrl1"]);
    expect(result.didAct).toBe(true);
    expect(creep.memory.claimError).toBeUndefined();
  });

  it("recycles itself the same tick the claim succeeds — the CLAIM part has no further use once owned", () => {
    const { creep, suicided } = colonizerAt(true);
    runStep(creep, { do: "claim" });
    expect(suicided()).toBe(true);
  });

  it("does not recycle itself on a rejected claim", () => {
    const { creep, suicided } = colonizerAt(true, ERR_GCL_NOT_ENOUGH);
    runStep(creep, { do: "claim" });
    expect(suicided()).toBe(false);
  });

  it("travels to the controller when out of range instead of claiming", () => {
    const { creep, claimed, traveled } = colonizerAt(false);
    const result = runStep(creep, { do: "claim" });
    expect(claimed).toEqual([]);
    expect(traveled).toEqual([{ x: 40, y: 40 }]);
    expect(result.didAct).toBe(false);
  });

  it("reports didAct:false on a rejected claim, so oneShot never falsely completes the step", () => {
    const { creep, claimed } = colonizerAt(true, ERR_GCL_NOT_ENOUGH);
    const result = runStep(creep, { do: "claim", oneShot: true });
    expect(claimed).toEqual(["ctrl1"]); // the call still fires every tick — only its outcome differs
    expect(result.didAct).toBe(false);
    expect(result.acted).toBe(true); // in range and resolved — distinct from "nothing to do"
  });

  it("remembers the failure code so a repeated identical failure isn't logged again", () => {
    const { creep } = colonizerAt(true, ERR_GCL_NOT_ENOUGH);
    runStep(creep, { do: "claim" });
    expect(creep.memory.claimError).toBe(ERR_GCL_NOT_ENOUGH);
    runStep(creep, { do: "claim" }); // second tick, same code — no crash, no new state
    expect(creep.memory.claimError).toBe(ERR_GCL_NOT_ENOUGH);
  });

  it("clears the remembered error once a claim finally succeeds", () => {
    const controller = { id: "ctrl1", pos: { x: 40, y: 40 } };
    let result: ScreepsReturnCode = ERR_GCL_NOT_ENOUGH;
    const creep = {
      name: "colonizer1",
      memory: { claimError: ERR_GCL_NOT_ENOUGH as ScreepsReturnCode | undefined },
      pos: { inRangeTo: () => true, findClosestByPath: (list: object[]) => list[0] ?? null },
      room: { name: "W2N2", controller },
      claimController: () => result,
      travelTo: () => undefined,
      suicide: () => OK
    } as unknown as Creep;

    result = OK;
    runStep(creep, { do: "claim" });
    expect(creep.memory.claimError).toBeUndefined();
  });

  it("attacks instead of claiming when the controller is reserved by another player", () => {
    const claimed: string[] = [];
    const attacked: string[] = [];
    const controller = { id: "ctrl1", pos: { x: 40, y: 40 }, reservation: { username: "BPC", ticksToEnd: 100 } };
    const creep = {
      name: "colonizer1",
      memory: {},
      pos: { inRangeTo: () => true, findClosestByPath: (list: object[]) => list[0] ?? null },
      room: { name: "W2N2", controller },
      claimController: (c: { id: string }) => {
        claimed.push(c.id);
        return OK;
      },
      attackController: (c: { id: string }) => {
        attacked.push(c.id);
        return OK;
      },
      travelTo: () => undefined,
      suicide: () => OK
    } as unknown as Creep;

    const result = runStep(creep, { do: "claim", oneShot: true });
    expect(attacked).toEqual(["ctrl1"]);
    expect(claimed).toEqual([]); // never tries claimController while a reservation is still standing
    expect(result.didAct).toBe(false); // attacking is not the job done — oneShot must not complete here
    expect(result.acted).toBe(true);
  });

  it("falls back to claiming once the reservation is gone", () => {
    const claimed: string[] = [];
    const controller = { id: "ctrl1", pos: { x: 40, y: 40 }, reservation: undefined };
    const creep = {
      name: "colonizer1",
      memory: {},
      pos: { inRangeTo: () => true, findClosestByPath: (list: object[]) => list[0] ?? null },
      room: { name: "W2N2", controller },
      claimController: (c: { id: string }) => {
        claimed.push(c.id);
        return OK;
      },
      attackController: () => {
        throw new Error("must not be called once unreserved");
      },
      travelTo: () => undefined,
      suicide: () => OK
    } as unknown as Creep;

    const result = runStep(creep, { do: "claim" });
    expect(claimed).toEqual(["ctrl1"]);
    expect(result.didAct).toBe(true);
  });
});

// renewCreep is called on the SPAWN, not the creep — unlike every other step, renewStep is hand-rolled
// around that inversion. Scoped to the creep's own targetRoom only (never a room it's merely transiting,
// like the sponsor's), and falls through (acted:false) whenever renewal isn't needed or isn't possible
// yet, so a settler's real work (build/upgrade) is never blocked by a renew step sitting first in line.
describe("renew step", () => {
  function settlerAt(opts: { ticksToLive?: number; inRange?: boolean; room?: string; hasSpawn?: boolean; renewResult?: ScreepsReturnCode }) {
    const { ticksToLive = 100, inRange = true, room = "W2N1", hasSpawn = true, renewResult = OK } = opts;
    const renewed: string[] = [];
    const traveled: { x: number; y: number }[] = [];
    const spawn = {
      id: "spawn1",
      structureType: STRUCTURE_SPAWN,
      pos: { x: 10, y: 10 },
      renewCreep: (c: { name: string }) => {
        renewed.push(c.name);
        return renewResult;
      }
    };
    const creep = {
      name: "settler1",
      ticksToLive,
      memory: { targetRoom: "W2N1" },
      pos: {
        inRangeTo: () => inRange,
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      room: { name: room, find: () => (hasSpawn ? [spawn] : []) },
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
    };
    return { creep: creep as unknown as Creep, renewed, traveled };
  }

  it("renews when in range, below the threshold, and in its target room", () => {
    const { creep, renewed } = settlerAt({ ticksToLive: 400 });
    const result = runStep(creep, { do: "renew", below: 500 });
    expect(renewed).toEqual(["settler1"]);
    expect(result).toEqual({ acted: true, didAct: true, target: "spawn1" });
  });

  it("falls through (acted:false) when ticksToLive is already comfortable", () => {
    const { creep, renewed } = settlerAt({ ticksToLive: 900 });
    const result = runStep(creep, { do: "renew", below: 500 });
    expect(renewed).toEqual([]);
    expect(result).toEqual({ acted: false, didAct: false });
  });

  it("falls through when the creep hasn't arrived in its target room yet", () => {
    const { creep, renewed } = settlerAt({ ticksToLive: 100, room: "W1N1" });
    const result = runStep(creep, { do: "renew", below: 500 });
    expect(renewed).toEqual([]);
    expect(result).toEqual({ acted: false, didAct: false });
  });

  it("falls through when the target room has no spawn yet", () => {
    const { creep, renewed } = settlerAt({ ticksToLive: 100, hasSpawn: false });
    const result = runStep(creep, { do: "renew", below: 500 });
    expect(renewed).toEqual([]);
    expect(result).toEqual({ acted: false, didAct: false });
  });

  it("travels to the spawn when out of range instead of renewing", () => {
    const { creep, renewed, traveled } = settlerAt({ ticksToLive: 100, inRange: false });
    const result = runStep(creep, { do: "renew", below: 500 });
    expect(renewed).toEqual([]);
    expect(traveled).toEqual([{ x: 10, y: 10 }]);
    expect(result).toEqual({ acted: true, didAct: false, target: "spawn1" });
  });

  it("reports didAct:false but stays engaged when the spawn rejects the call (e.g. busy spawning)", () => {
    const { creep, renewed } = settlerAt({ ticksToLive: 100, renewResult: ERR_BUSY });
    const result = runStep(creep, { do: "renew", below: 500 });
    expect(renewed).toEqual(["settler1"]);
    expect(result).toEqual({ acted: true, didAct: false, target: "spawn1" });
  });
});

// A defender fights whatever hostile resolves nearest. A melee-only body (no RANGED_ATTACK) closes to
// range 1 and swings. A RANGED_ATTACK body kites: fires anywhere inside range 3, and flees directly away
// the moment the hostile has closed inside that range, rather than standing still and trading hits.
describe("attack step", () => {
  function fighter(over: { rangedParts?: number; range: number; fx?: number; fy?: number; hx?: number; hostileHasAttack?: boolean }) {
    const fx = over.fx ?? 20;
    const fy = over.fy ?? 20;
    // hostile placed `range` tiles east of the fighter, unless an explicit hx pins it elsewhere (e.g. on
    // the room border, where "east of fx by `range`" can't express a fixed absolute position).
    const hx = over.hx ?? (over.range === 0 ? fx : fx + over.range);
    // Defaults to armed (hostileHasAttack: true) so the pre-existing kiting tests keep exercising the
    // kite path unchanged; only the new "closes on an unarmed hostile" tests opt out.
    const hasAttack = over.hostileHasAttack ?? true;
    const hostile = {
      id: "hostile1",
      pos: { x: hx, y: fy },
      getActiveBodyparts: (part: BodyPartConstant) => (part === ATTACK && hasAttack ? 1 : 0)
    };
    const attacked: string[] = [];
    const rangedAttacked: string[] = [];
    const rangedMassAttacked: number[] = [];
    const traveled: { x: number; y: number }[] = [];
    stubGame({ objects: {} });
    const creep = {
      pos: {
        x: fx,
        y: fy,
        roomName: "W1N1",
        inRangeTo: (pos: { x: number; y: number }, range: number) => Math.abs(fx - pos.x) <= range && Math.abs(fy - pos.y) <= range,
        getRangeTo: (pos: { x: number; y: number }) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)),
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      room: { find: () => [hostile] },
      getActiveBodyparts: (part: BodyPartConstant) => (part === RANGED_ATTACK ? (over.rangedParts ?? 1) : 0),
      attack: (t: { id: string }) => attacked.push(t.id),
      rangedAttack: (t: { id: string }) => rangedAttacked.push(t.id),
      rangedMassAttack: () => rangedMassAttacked.push(1),
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
    };
    return { creep: creep as unknown as Creep, attacked, rangedAttacked, rangedMassAttacked, traveled };
  }

  it("ranged-attacks a hostile at the outer edge of range 3 and holds position — no closer, no farther", () => {
    const { creep, rangedAttacked, attacked, traveled } = fighter({ rangedParts: 1, range: 3 });
    const result = runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(rangedAttacked).toEqual(["hostile1"]);
    expect(attacked).toEqual([]);
    expect(traveled).toEqual([]);
    expect(result).toEqual({ acted: true, didAct: true, target: "hostile1" });
  });

  it("fires and flees when a hostile has closed inside firing range, instead of standing still", () => {
    const { creep, rangedAttacked, traveled } = fighter({ rangedParts: 1, range: 1 });
    const result = runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(rangedAttacked).toEqual(["hostile1"]); // still fires this tick — full damage anywhere inside 3
    // Hostile sits due east (higher x, same y); fleeing steps west and off-axis (the fallback nudge that
    // keeps fleeSpot's y-component non-zero even on a perfectly aligned approach).
    expect(traveled).toEqual([{ x: 19, y: 21 }]);
    expect(result.didAct).toBe(true);
  });

  it("closes distance when a ranged body is outside firing range", () => {
    const { creep, rangedAttacked, traveled } = fighter({ rangedParts: 1, range: 5 });
    const result = runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(rangedAttacked).toEqual([]);
    // travelTo is handed the hostile's raw position plus a range option — the path engine (stubbed out
    // here) is what actually stops short at range 3, not this call site.
    expect(traveled).toEqual([{ x: 25, y: 20 }]);
    expect(result).toEqual({ acted: true, didAct: false, target: "hostile1" });
  });

  it("closes to melee range on an unarmed hostile instead of holding at range 3", () => {
    // No ATTACK part anywhere nearby (this hostile is the only one, and it's unarmed) — free to close in.
    const { creep, rangedAttacked, traveled } = fighter({ rangedParts: 1, range: 3, hostileHasAttack: false });
    const result = runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(rangedAttacked).toEqual(["hostile1"]); // still fires this tick from range 3
    expect(traveled).toEqual([{ x: 23, y: 20 }]); // travelTo the hostile at range 1, not held at range 3
    expect(result).toEqual({ acted: true, didAct: true, target: "hostile1" });
  });

  it("closes toward an unarmed hostile camped on the exit tile without stepping onto the border itself", () => {
    // Fighter at x=3, unarmed hostile sitting right on the west exit tile (x=0). Closing to literal
    // range 1 of it would require standing at x=1 — clampInterior pulls the approach target to x=1
    // instead (its own clamp floor), which travelTo(..., {range:1}) is handed as-is; the fighter still
    // narrows the gap without ever being routed onto x=0.
    const { creep, traveled } = fighter({ rangedParts: 1, range: 3, hostileHasAttack: false, fx: 3, hx: 0 });
    runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(traveled).toEqual([{ x: 1, y: 20 }]);
  });

  it("does not flee an unarmed hostile that has closed inside firing range — holds and fires", () => {
    const { creep, rangedAttacked, traveled } = fighter({ rangedParts: 1, range: 1, hostileHasAttack: false });
    const result = runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(rangedAttacked).toEqual(["hostile1"]);
    expect(traveled).toEqual([]); // already within range 1 of the target — the "close in" branch requires range > 1
    expect(result.didAct).toBe(true);
  });

  it("still flees a hostile with ATTACK parts even if it isn't the resolved target", () => {
    // Two hostiles: the resolved (nearest) target is unarmed and already at point-blank range, but a
    // second, armed hostile sits farther out, still within the engagement zone — must still flee the
    // *resolved target's* position rather than close in on it, because closing in would walk the fighter
    // deeper into the armed hostile's reach too. (Two hostiles in range also makes rangedMassAttack the
    // better call than single-target rangedAttack, so this test only asserts on movement — the separate
    // "uses rangedMassAttack" test below covers firing mode.)
    const fx = 20;
    const fy = 20;
    const target = { id: "target1", pos: { x: 21, y: 20 }, getActiveBodyparts: () => 0 }; // range 1, nearest
    const armed = { id: "armed1", pos: { x: 20, y: 23 }, getActiveBodyparts: (part: BodyPartConstant) => (part === ATTACK ? 1 : 0) }; // range 3
    const traveled: { x: number; y: number }[] = [];
    stubGame({ objects: {} });
    const creep = {
      pos: {
        x: fx,
        y: fy,
        roomName: "W1N1",
        inRangeTo: (pos: { x: number; y: number }, range: number) => Math.abs(fx - pos.x) <= range && Math.abs(fy - pos.y) <= range,
        getRangeTo: (pos: { x: number; y: number }) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)),
        findClosestByPath: (list: { pos: { x: number; y: number } }[]) => list[0] ?? null
      },
      room: { find: () => [target, armed] },
      getActiveBodyparts: (part: BodyPartConstant) => (part === RANGED_ATTACK ? 1 : 0),
      rangedAttack: () => undefined,
      rangedMassAttack: () => undefined,
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
    } as unknown as Creep;
    const result = runStep(creep, { do: "attack", from: { find: "hostile" } }); // default "nearest" resolves target1
    // Fled away from the resolved target (due east) rather than closed in, because the armed hostile at
    // range 3 is still within the engagement zone that gates the close-in behavior.
    expect(traveled).toEqual([{ x: 19, y: 21 }]);
    expect(result.didAct).toBe(true);
  });

  it("uses rangedMassAttack over rangedAttack when hitting a cluster deals more total damage", () => {
    const fx = 20;
    const fy = 20;
    // Four unarmed hostiles at range 1 (10 dmg/part each via mass attack = 40) vs a single rangedAttack's
    // flat 10 — mass attack wins outright.
    const positions = [
      { x: 21, y: 20 },
      { x: 21, y: 21 },
      { x: 19, y: 20 },
      { x: 20, y: 21 }
    ];
    const cluster = positions.map((pos, i) => ({
      id: `h${i}`,
      pos,
      getActiveBodyparts: () => 0
    }));
    const rangedAttacked: string[] = [];
    const rangedMassAttacked: number[] = [];
    const traveled: { x: number; y: number }[] = [];
    stubGame({ objects: {} });
    const creep = {
      pos: {
        x: fx,
        y: fy,
        roomName: "W1N1",
        inRangeTo: (pos: { x: number; y: number }, range: number) => Math.abs(fx - pos.x) <= range && Math.abs(fy - pos.y) <= range,
        getRangeTo: (pos: { x: number; y: number }) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)),
        findClosestByPath: (list: { pos: { x: number; y: number } }[]) => list[0] ?? null
      },
      room: { find: () => cluster },
      getActiveBodyparts: (part: BodyPartConstant) => (part === RANGED_ATTACK ? 1 : 0),
      rangedAttack: (t: { id: string }) => rangedAttacked.push(t.id),
      rangedMassAttack: () => rangedMassAttacked.push(1),
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
    } as unknown as Creep;
    const result = runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(rangedMassAttacked).toEqual([1]);
    expect(rangedAttacked).toEqual([]);
    expect(result.didAct).toBe(true);
  });

  it("melee-attacks once in range 1 when the body has no RANGED_ATTACK", () => {
    const { creep, attacked, rangedAttacked, traveled } = fighter({ rangedParts: 0, range: 1 });
    const result = runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(attacked).toEqual(["hostile1"]);
    expect(rangedAttacked).toEqual([]);
    expect(traveled).toEqual([]); // range 1 IS attack range for melee — no separate move needed
    expect(result).toEqual({ acted: true, didAct: true, target: "hostile1" });
  });

  it("melee travels toward the hostile when out of range instead of attacking", () => {
    const { creep, attacked, traveled } = fighter({ rangedParts: 0, range: 4 });
    const result = runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(attacked).toEqual([]);
    expect(traveled).toEqual([{ x: 24, y: 20 }]);
    expect(result).toEqual({ acted: true, didAct: false, target: "hostile1" });
  });

  it("no-ops when no hostile is present", () => {
    const { creep } = fighter({ rangedParts: 1, range: 3 });
    (creep.room.find as () => object[]) = () => [];
    const result = runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(result).toEqual({ acted: false, didAct: false });
  });

  // Regression: fleeSpot used to clamp straight to [0,49], which collapses to the fighter's OWN tile
  // once it's already pinned against a room edge — travelTo(currentPos) is a no-op, so a ranged defender
  // chased onto a border froze there forever while the (unclamped) hostile kept closing and eventually
  // caught it at point-blank. The fix slides the fighter along the blocked edge instead of freezing.
  function borderFighter(fx: number, fy: number, hx: number, hy: number) {
    const hostile = {
      id: "hostile1",
      pos: { x: hx, y: hy },
      getActiveBodyparts: (part: BodyPartConstant) => (part === ATTACK ? 1 : 0)
    };
    const traveled: { x: number; y: number }[] = [];
    stubGame({ objects: {} });
    const creep = {
      pos: {
        x: fx,
        y: fy,
        roomName: "W1N1",
        inRangeTo: (pos: { x: number; y: number }, range: number) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)) <= range,
        getRangeTo: (pos: { x: number; y: number }) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)),
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      room: { find: () => [hostile] },
      getActiveBodyparts: (part: BodyPartConstant) => (part === RANGED_ATTACK ? 1 : 0),
      rangedAttack: () => undefined,
      rangedMassAttack: () => undefined,
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
    };
    return { creep: creep as unknown as Creep, traveled };
  }

  it("steps off the exit tile onto x=1 rather than holding on the border when pinned against x=0", () => {
    // Fighter caught standing on the west exit row (x=0); hostile has closed in from due east at range 1.
    const { creep, traveled } = borderFighter(0, 20, 1, 20);
    runStep(creep, { do: "attack", from: { find: "hostile" } });
    // x can't retreat past the room-interior clamp (1), so it's pulled back onto x=1 instead of staying
    // on the exit tile; y (the free axis) carries the rest of the flee.
    expect(traveled).toEqual([{ x: 1, y: 21 }]);
  });

  it("steps off the exit tile onto y=1 rather than holding on the border when pinned against y=0", () => {
    const { creep, traveled } = borderFighter(20, 0, 20, 1);
    runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(traveled).toEqual([{ x: 21, y: 1 }]);
  });

  it("retreats off both exit rows into the room interior even when cornered", () => {
    // Fighter caught standing in the top-left corner exit tile (0,0); hostile bearing from the southeast.
    const { creep, traveled } = borderFighter(0, 0, 1, 1);
    runStep(creep, { do: "attack", from: { find: "hostile" } });
    // Both axes clamp to the interior (1,1) rather than holding on the corner exit tile — the corner is
    // itself never a legal flee destination anymore, so there's always somewhere to step off it to.
    expect(traveled).toEqual([{ x: 1, y: 1 }]);
  });

  it("never targets an exit tile even when already one step off the border", () => {
    // Fighter at x=1 (one tile inside the west wall); hostile closing from due east forces a flee west,
    // which the old, unclamped math would have landed squarely on the x=0 exit tile.
    const { creep, traveled } = borderFighter(1, 20, 2, 20);
    runStep(creep, { do: "attack", from: { find: "hostile" } });
    expect(traveled).toEqual([{ x: 1, y: 21 }]); // held at x=1, not pushed onto x=0
  });
});

// A healer targets its squad-mates (find:"squadMate", same memory.op — see ADR 0006), ranked by
// mostDamaged. creep.heal() at range 1 (full power); creep.rangedHeal() at range 2-3 (reduced power);
// travelTo closes distance when out of range 3 entirely. No kiting (unlike attackStep) — just get in
// range and heal. Store-less: never self-completes on store state, only via targetGone.
describe("heal step", () => {
  function healerAt(over: { hx?: number; hy?: number; fx?: number; fy?: number; mates?: object[]; hits?: number; hitsMax?: number }) {
    const fx = over.fx ?? 20;
    const fy = over.fy ?? 20;
    const healed: string[] = [];
    const rangedHealed: string[] = [];
    const traveled: { x: number; y: number }[] = [];
    stubGame({ objects: {} });
    const creep = {
      id: "healer1",
      hits: over.hits ?? 500,
      hitsMax: over.hitsMax ?? 500,
      pos: {
        x: fx,
        y: fy,
        roomName: "W1N1",
        inRangeTo: (pos: { x: number; y: number }, range: number) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)) <= range,
        getRangeTo: (pos: { x: number; y: number }) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)),
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      memory: { op: "drain:W1N1" },
      heal: (t: { id: string }) => healed.push(t.id),
      rangedHeal: (t: { id: string }) => rangedHealed.push(t.id),
      travelTo: (p: { x: number; y: number }) => traveled.push({ x: p.x, y: p.y })
    };
    // FIND_MY_CREEPS includes the acting creep itself, same as the real engine — the squadMate candidate
    // pool relies on this so self is always a valid heal target.
    (creep as unknown as { room: { find: () => object[] } }).room = { find: () => [...(over.mates ?? []), creep] };
    return { creep: creep as unknown as Creep, healed, rangedHealed, traveled };
  }

  it("melee-heals the most damaged squad-mate at range 1, and still travels toward it", () => {
    // heal is a move-kind step (STEP_KIND) that only completes via targetGone, never on its own — and
    // find:"squadMate" always resolves to SOMETHING (self included). Without a travelTo call even in the
    // in-range case, a healer whose target never moves away is permanently parked here the instant it
    // lands on this step, unable to ever fall back to a preceding moveToRoom step's own destination.
    // Confirmed live: a drain healer wedged healing an at-full-HP squad-mate forever, never resuming
    // travel toward its actual rally room.
    const mate = {
      id: "mate1",
      pos: { x: 21, y: 20 },
      hits: 200,
      hitsMax: 500,
      memory: { op: "drain:W1N1", role: "drainHealer" }
    };
    const { creep, healed, rangedHealed, traveled } = healerAt({ mates: [mate] });
    const result = runStep(creep, { do: "heal", at: { find: "squadMate", prefer: "mostDamaged" } });
    expect(healed).toEqual(["mate1"]);
    expect(rangedHealed).toEqual([]);
    expect(traveled).toEqual([{ x: 21, y: 20 }]);
    expect(result).toEqual({ acted: true, didAct: true, target: "mate1" });
  });

  it("ranged-heals a squad-mate at range 2-3, and still travels toward it", () => {
    const mate = {
      id: "mate1",
      pos: { x: 23, y: 20 },
      hits: 200,
      hitsMax: 500,
      memory: { op: "drain:W1N1", role: "drainHealer" }
    };
    const { creep, healed, rangedHealed, traveled } = healerAt({ mates: [mate] });
    const result = runStep(creep, { do: "heal", at: { find: "squadMate", prefer: "mostDamaged" } });
    expect(rangedHealed).toEqual(["mate1"]);
    expect(healed).toEqual([]);
    expect(traveled).toEqual([{ x: 23, y: 20 }]);
    expect(result).toEqual({ acted: true, didAct: true, target: "mate1" });
  });

  it("closes distance via travelTo when out of range 3", () => {
    const mate = {
      id: "mate1",
      pos: { x: 26, y: 20 },
      hits: 200,
      hitsMax: 500,
      memory: { op: "drain:W1N1", role: "drainHealer" }
    };
    const { creep, healed, rangedHealed, traveled } = healerAt({ mates: [mate] });
    const result = runStep(creep, { do: "heal", at: { find: "squadMate", prefer: "mostDamaged" } });
    expect(healed).toEqual([]);
    expect(rangedHealed).toEqual([]);
    expect(traveled).toEqual([{ x: 26, y: 20 }]);
    expect(result).toEqual({ acted: true, didAct: false, target: "mate1" });
  });

  it("includes itself as a candidate and heals itself when it is the most damaged", () => {
    const mate = {
      id: "mate1",
      pos: { x: 21, y: 20 },
      hits: 480,
      hitsMax: 500,
      memory: { op: "drain:W1N1", role: "drainHealer" }
    };
    const { creep, healed } = healerAt({ mates: [mate], fx: 20, fy: 20, hits: 100, hitsMax: 500 });
    const result = runStep(creep, { do: "heal", at: { find: "squadMate", prefer: "mostDamaged" } });
    expect(healed).toEqual(["healer1"]);
    expect(result).toEqual({ acted: true, didAct: true, target: "healer1" });
  });

  it("heals nothing when no squad-mate is damaged (falls through, acted:false)", () => {
    // Only candidate is self, and self is at full health — mostDamaged still picks it (it's the only
    // candidate), but a healer's own steps would normally gate on `where: "damaged"` in the real role;
    // this proves the primitive resolves and acts on a full-health self, i.e. there is no implicit
    // "skip if undamaged" behavior baked into healStep itself — that gating is the role's job, not the verb's.
    const { creep, healed } = healerAt({ mates: [] });
    const result = runStep(creep, { do: "heal", at: { find: "squadMate", prefer: "mostDamaged" } });
    expect(healed).toEqual(["healer1"]);
    expect(result).toEqual({ acted: true, didAct: true, target: "healer1" });
  });

  it("no-ops when no squad-mate resolves at all (op mismatch)", () => {
    const stranger = {
      id: "stranger1",
      pos: { x: 21, y: 20 },
      hits: 100,
      hitsMax: 500,
      memory: { op: "different-op", role: "drainHealer" }
    };
    const { creep, healed, rangedHealed } = healerAt({ mates: [stranger] });
    // Blank out the acting creep's own op so even itself no longer resolves as a squadMate — isolates
    // the "genuinely nothing resolves" no-op path (targetGone via resolveTarget returning null).
    (creep as unknown as { memory: { op?: string } }).memory.op = undefined;
    const result = runStep(creep, { do: "heal", at: { find: "squadMate", prefer: "mostDamaged" } });
    expect(healed).toEqual([]);
    expect(rangedHealed).toEqual([]);
    expect(result).toEqual({ acted: false, didAct: false });
  });
});
