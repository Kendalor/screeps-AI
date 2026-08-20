// Regression coverage for planTransportTask's cross-resource race (behaviors/transportTaskRunner.ts) —
// no unit test existed for this file before this was found live on the pserver. A prior version of
// planTransportTask's empty-creep branch walked resources in a fixed energy-first order and returned the
// FIRST resource with a workable withdraw+deliver pair, so a starved mineral request was never even
// SCORED while any energy withdraw+deliver pair existed — the PRD's/ADR 0008's headline claim ("a
// long-starved mineral pickup can win a creep's next trip over a routine energy hop") was structurally
// unreachable through the live Transport role, even though request.ts's scoreRequest/pickBestRequest
// (proven correct in isolation by test/unit/logistics/register.test.ts) ranked correctly whenever both
// were handed to it directly. This file drives planTransportTask itself — the actual live entry point —
// against minimal stubs of the exact Game API surface it reads, same "fake the live-object shape, not a
// ColonySnapshot" pattern register.test.ts/stewardRegister.test.ts already use.

import { beforeEach, describe, expect, it } from "vitest";
import { planTransportTask } from "../../../src/behaviors/transportTaskRunner";

// buildTransportPool's registerRemoteGroundResources reads Memory.colonies[home].remotes — no remote rooms are
// exercised by these tests, but the global must exist or that read throws before the room's own local
// registration (source/mineral/storage) ever gets a chance to run.
beforeEach(() => {
  (globalThis as Record<string, unknown>).Memory = { colonies: { W1N1: { remotes: [] } } };
});

const ENERGY_CONTAINER_CAPACITY = 2000;
const MINERAL_CONTAINER_CAPACITY = 2000;
const STORAGE_CAPACITY = 1_000_000;
const ZYNTHIUM: MineralConstant = "Z";

function pos(x: number, y: number, roomName = "W1N1"): RoomPosition {
  const self = {
    x,
    y,
    roomName,
    getRangeTo: (other: { pos?: RoomPosition } | RoomPosition) => {
      const o = (other as { pos?: RoomPosition }).pos ?? (other as RoomPosition);
      return Math.max(Math.abs(x - o.x), Math.abs(y - o.y));
    },
    findInRange: () => [] as unknown[]
  };
  return self as unknown as RoomPosition;
}

function stubEnergyContainer(stored: number, x: number, y: number): StructureContainer {
  return {
    id: `energyContainer_${x}_${y}` as Id<StructureContainer>,
    pos: pos(x, y),
    structureType: STRUCTURE_CONTAINER,
    store: {
      getUsedCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? stored : 0),
      getCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? ENERGY_CONTAINER_CAPACITY : 0),
      getFreeCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? ENERGY_CONTAINER_CAPACITY - stored : 0)
    }
  } as unknown as StructureContainer;
}

function stubMineralContainer(stored: number, x: number, y: number): StructureContainer {
  return {
    id: `mineralContainer_${x}_${y}` as Id<StructureContainer>,
    pos: pos(x, y),
    structureType: STRUCTURE_CONTAINER,
    store: {
      getUsedCapacity: (r: ResourceConstant) => (r === ZYNTHIUM ? stored : 0),
      getCapacity: (r: ResourceConstant) => (r === ZYNTHIUM ? MINERAL_CONTAINER_CAPACITY : 0),
      getFreeCapacity: (r: ResourceConstant) => (r === ZYNTHIUM ? MINERAL_CONTAINER_CAPACITY - stored : 0)
    }
  } as unknown as StructureContainer;
}

function stubStorage(energy: number, mineral: number, x: number, y: number): StructureStorage {
  return {
    id: "storage1" as Id<StructureStorage>,
    pos: pos(x, y),
    structureType: STRUCTURE_STORAGE,
    store: {
      getUsedCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? energy : r === ZYNTHIUM ? mineral : 0),
      getCapacity: () => STORAGE_CAPACITY,
      getFreeCapacity: (r: ResourceConstant) =>
        r === RESOURCE_ENERGY ? STORAGE_CAPACITY - energy - mineral : r === ZYNTHIUM ? STORAGE_CAPACITY - energy - mineral : 0
    }
  } as unknown as StructureStorage;
}

interface RoomSetup {
  source?: { pos: RoomPosition; container?: StructureContainer };
  mineral?: { pos: RoomPosition; mineralType: MineralConstant; container?: StructureContainer };
  storage?: StructureStorage;
  controller?: StructureController;
}

// A minimal Room stub covering only what buildTransportPool (transportTaskRunner.ts) reads: find() for
// FIND_SOURCES/FIND_MINERALS/FIND_MY_CREEPS, plus .controller/.storage/.name directly.
function stubRoom(setup: RoomSetup): Room {
  const source = setup.source
    ? ({
        pos: { ...setup.source.pos, findInRange: () => (setup.source!.container ? [setup.source!.container] : []) }
      } as unknown as Source)
    : undefined;
  const mineral = setup.mineral
    ? ({
        mineralType: setup.mineral.mineralType,
        pos: { ...setup.mineral.pos, findInRange: () => (setup.mineral!.container ? [setup.mineral!.container] : []) }
      } as unknown as Mineral)
    : undefined;

  return {
    name: "W1N1",
    controller: setup.controller,
    storage: setup.storage,
    find: (findConstant: FindConstant) => {
      if (findConstant === FIND_SOURCES) return source ? [source] : [];
      if (findConstant === FIND_MINERALS) return mineral ? [mineral] : [];
      if (findConstant === FIND_MY_CREEPS) return [];
      if (findConstant === FIND_DROPPED_RESOURCES) return [];
      if (findConstant === FIND_TOMBSTONES) return [];
      if (findConstant === FIND_RUINS) return [];
      return [];
    }
  } as unknown as Room;
}

function stubCreep(x: number, y: number, carrying?: { resource: ResourceConstant; amount: number }): Creep {
  const store = {
    getUsedCapacity: (r: ResourceConstant) => (carrying && carrying.resource === r ? carrying.amount : 0),
    getFreeCapacity: (r: ResourceConstant) => 50 - (carrying && carrying.resource === r ? carrying.amount : 0)
  };
  return {
    pos: pos(x, y),
    store,
    memory: { logisticsTask: undefined }
  } as unknown as Creep;
}

describe("planTransportTask's cross-resource race (regression: mineral must be able to outrank energy)", () => {
  it("a long-starved mineral withdraw candidate wins over a routine, always-available energy candidate at comparable distance", () => {
    // Energy: a routine, always-topped-up container (half full — comfortably above the register
    // threshold) a couple tiles from the creep. Mineral: a container starved to near-full (the
    // "long-starved" case the PRD's user story 1 describes) at a similar distance. Both have a deliver
    // target — storage accepts both resources.
    const energyContainer = stubEnergyContainer(Math.floor(ENERGY_CONTAINER_CAPACITY * 0.5), 3, 0);
    const mineralContainer = stubMineralContainer(Math.floor(MINERAL_CONTAINER_CAPACITY * 0.95), 3, 5);
    const storage = stubStorage(0, 0, 3, 10);

    const room = stubRoom({
      source: { pos: pos(3, 0), container: energyContainer },
      mineral: { pos: pos(3, 5), mineralType: ZYNTHIUM, container: mineralContainer },
      storage
    });

    const creep = stubCreep(0, 0);
    const task = planTransportTask(creep, room, []);

    expect(task).toBeDefined();
    expect(task?.kind).toBe("withdraw");
    expect(task?.resource).toBe(ZYNTHIUM);
    expect(task?.target).toBe(mineralContainer);
    expect(task?.parent?.kind).toBe("transfer");
    expect(task?.parent?.target).toBe(storage);
  });

  it("a fresh, barely-registered mineral trickle still loses to a routine energy pickup (not a blanket mineral-always-wins bias)", () => {
    // Mirrors the pure-function proof in register.test.ts's "fresh mineral trickle" case, but through the
    // real live entry point — confirms the fix didn't overcorrect into an unconditional mineral
    // preference, only a genuine rate race.
    const energyContainer = stubEnergyContainer(Math.floor(ENERGY_CONTAINER_CAPACITY * 0.5), 3, 0);
    const mineralContainer = stubMineralContainer(1, 3, 5); // just registered, no threshold — trivial amount
    const storage = stubStorage(0, 0, 3, 10);

    const room = stubRoom({
      source: { pos: pos(3, 0), container: energyContainer },
      mineral: { pos: pos(3, 5), mineralType: ZYNTHIUM, container: mineralContainer },
      storage
    });

    const creep = stubCreep(0, 0);
    const task = planTransportTask(creep, room, []);

    expect(task).toBeDefined();
    expect(task?.kind).toBe("withdraw");
    expect(task?.resource).toBe(RESOURCE_ENERGY);
    expect(task?.target).toBe(energyContainer);
  });

  it("mineral with nowhere to deliver to (no storage) never wins, regardless of how starved it is", () => {
    const energyContainer = stubEnergyContainer(Math.floor(ENERGY_CONTAINER_CAPACITY * 0.5), 3, 0);
    const mineralContainer = stubMineralContainer(MINERAL_CONTAINER_CAPACITY, 3, 5); // maximally starved

    const room = stubRoom({
      source: { pos: pos(3, 0), container: energyContainer },
      mineral: { pos: pos(3, 5), mineralType: ZYNTHIUM, container: mineralContainer }
      // no storage — mineral has nowhere to be delivered
    });

    const creep = stubCreep(0, 0);
    const task = planTransportTask(creep, room, []);

    // Energy also has no deliver target here (no storage, no controller container, no battery creeps) —
    // so nothing should be planned at all, and critically NOT a bare mineral withdraw with no parent.
    expect(task).toBeUndefined();
  });
});
