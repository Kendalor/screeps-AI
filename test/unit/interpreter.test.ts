import { describe, expect, it } from "vitest";
import { advanceRoute, canCoFire, firstRunnableStep, nextStep, runStep, type CreepState } from "../../src/behaviors/interpreter";
import type { Step } from "../../src/behaviors/types";
import { stubGame } from "../helpers";

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
      containerPos: { x: 25, y: 27 }
    });

    const result = runStep(creep, { do: "upgrade" });

    expect(upgraded).toEqual(["controller1"]);
    expect(traveled).toEqual([{ x: 25, y: 27 }]);
    expect(result).toEqual({ acted: true, didAct: true, target: "controller1" });
  });

  it("stays put and keeps upgrading once parked on the controller container", () => {
    const { creep, traveled, upgraded } = upgradeCreep({
      pos: { x: 25, y: 27 },
      containerPos: { x: 25, y: 27 }
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

// A remote miner is spawned at home with memory.targetRoom set to its source's room and a stored route.
// moveToRoom { to: "targetRoom" } walks it there; only once it has arrived do the harvest steps engage.
describe("moveToRoom to a creep's targetRoom", () => {
  function roamer(room: string, targetRoom: string, route?: { dest: string; rooms: string[]; index: number }) {
    const traveled: { x: number; y: number; room: string }[] = [];
    const creep = {
      room: { name: room },
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

  it("follows the stored route's next room rather than jumping to the destination", () => {
    // Two rooms out: the next hop is W2N1, not the final W3N1.
    const route = { dest: "W3N1", rooms: ["W2N1", "W3N1"], index: 0 };
    const { creep, traveled } = roamer("W1N1", "W3N1", route);
    runStep(creep, { do: "moveToRoom", to: "targetRoom" });
    expect(traveled).toEqual([{ x: 25, y: 25, room: "W2N1" }]);
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
