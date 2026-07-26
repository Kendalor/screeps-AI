import { describe, expect, it } from "vitest";
import { ROLES } from "../../src/behaviors/roles";
import { runCreepBehaviors } from "../../src/empire/creeps";
import { stubGame } from "../helpers";

// Driven through runCreepBehaviors (the public entry point) rather than the private
// runOne, so the test survives refactors of the dispatch internals.

function siteObj(id: string): object {
  return { id, pos: { x: 10, y: 10 }, progress: 0, progressTotal: 100 };
}

// Parked out of range of its site (so it travels rather than arriving) with a
// half-full store, so the build step neither completes nor advances between ticks.
const BUILD_STEP = ROLES.builder.steps.findIndex(s => s.do === "build");

function builder(sites: object[]): Creep {
  return {
    name: "b1",
    spawning: false,
    memory: { role: "builder", task: { step: BUILD_STEP } },
    store: { getFreeCapacity: () => 25, getUsedCapacity: () => 25 },
    pos: {
      x: 5,
      y: 5,
      findClosestByPath: (list: object[]) => list[0] ?? null,
      inRangeTo: () => false
    },
    // Only construction sites resolve; every other find-type (dropped energy, structures, other
    // creeps) comes back empty, so co-fire's scan through builder's other steps finds nothing to
    // act on rather than misreading `sites` as candidates for a different find-type.
    room: { find: (kind: FindConstant) => (kind === FIND_MY_CONSTRUCTION_SITES ? sites : []) },
    build: () => 0,
    travelTo: () => undefined
  } as unknown as Creep;
}

describe("creep dispatch target locking", () => {
  it("stores the acted-on target as the creep's lock", () => {
    const site = siteObj("siteA");
    stubGame({ objects: { siteA: site } });
    const creep = builder([site]);
    Game.creeps = { b1: creep };

    runCreepBehaviors();

    expect(creep.memory.task?.target).toBe("siteA");
  });

  it("keeps building the locked site when a nearer one appears mid-journey", () => {
    const first = siteObj("first");
    const nearer = siteObj("nearer");
    stubGame({ objects: { first, nearer } });
    const creep = builder([first]);
    Game.creeps = { b1: creep };

    runCreepBehaviors();
    expect(creep.memory.task?.target).toBe("first");

    (creep as unknown as { room: { find: (kind: FindConstant) => object[] } }).room.find = kind =>
      kind === FIND_MY_CONSTRUCTION_SITES ? [nearer, first] : [];
    runCreepBehaviors();

    expect(creep.memory.task?.target).toBe("first");
  });

  it("relocks onto a new target once the locked site is finished", () => {
    const first = siteObj("first");
    const next = siteObj("next");
    stubGame({ objects: { first, next } });
    const creep = builder([first]);
    Game.creeps = { b1: creep };

    runCreepBehaviors();
    expect(creep.memory.task?.target).toBe("first");

    // The site completed: it no longer resolves by id and is gone from the room.
    Game.getObjectById = ((id: string) => (id === "next" ? next : null)) as typeof Game.getObjectById;
    (creep as unknown as { room: { find: (kind: FindConstant) => object[] } }).room.find = kind =>
      kind === FIND_MY_CONSTRUCTION_SITES ? [next] : [];
    runCreepBehaviors();

    expect(creep.memory.task?.target).toBe("next");
  });
});

// Steps 0-3 of the builder loop (pickup, withdraw x3) resolve nothing this tick; only the harvest
// step (step 4) has a live source. A dead target costs no game API call, so the dispatch should
// walk past every empty step and act on the source in the same tick rather than idling until the
// next call finally lands on step 4.
function builderWithOnlySource(source: object): Creep {
  return {
    name: "b1",
    spawning: false,
    memory: { role: "builder", task: { step: 0 } },
    store: { getFreeCapacity: () => 50, getUsedCapacity: () => 0 },
    pos: {
      x: 5,
      y: 5,
      findClosestByPath: (list: object[]) => list[0] ?? null,
      inRangeTo: () => true
    },
    room: {
      find: (kind: FindConstant) => (kind === FIND_SOURCES ? [source] : [])
    },
    harvest: () => 0,
    travelTo: () => undefined
  } as unknown as Creep;
}

const OPEN_TERRAIN = { getTerrain: () => ({ get: () => 0 }) };

function sourcePos(x: number, y: number) {
  return {
    x,
    y,
    findInRange: () => [],
    isEqualTo: (other: { x: number; y: number }) => other.x === x && other.y === y,
    inRangeTo: (other: { x: number; y: number }, range: number) =>
      Math.max(Math.abs(other.x - x), Math.abs(other.y - y)) <= range
  };
}

describe("same-tick retry past dead targets", () => {
  it("skips every step with nothing to resolve and acts on the first live one, same tick", () => {
    const source = { id: "src", energy: 100, pos: sourcePos(5, 5), room: OPEN_TERRAIN };
    stubGame({ objects: { src: source } });
    const creep = builderWithOnlySource(source);
    Game.creeps = { b1: creep };

    runCreepBehaviors();

    // Landed on and acted on the harvest step (index 1) this same tick, not left idling on step 0.
    expect(creep.memory.task?.target).toBe("src");
    expect(creep.memory.task?.step).toBe(1);
  });

  it("stays idle for the tick, without throwing, when nothing in the loop resolves anywhere", () => {
    stubGame({ objects: {} });
    const creep = builderWithOnlySource({ id: "src", energy: 100, pos: sourcePos(5, 5), room: OPEN_TERRAIN });
    (creep as unknown as { room: { find: () => object[] } }).room.find = () => [];
    Game.creeps = { b1: creep };

    expect(() => runCreepBehaviors()).not.toThrow();
    expect(creep.memory.task?.target).toBeUndefined();
  });

  it("still terminates after one successful act when the very first step resolves (no unnecessary looping)", () => {
    const dropped = { id: "pile", amount: 100, resourceType: RESOURCE_ENERGY, pos: { x: 5, y: 5 } };
    stubGame({ objects: { pile: dropped } });
    const creep = {
      name: "b1",
      spawning: false,
      memory: { role: "builder", task: { step: 0 } },
      store: { getFreeCapacity: () => 50, getUsedCapacity: () => 0 },
      pos: {
        x: 5,
        y: 5,
        findClosestByPath: (list: object[]) => list[0] ?? null,
        inRangeTo: () => true
      },
      room: {
        find: (kind: FindConstant) => (kind === FIND_DROPPED_RESOURCES ? [dropped] : [])
      },
      pickup: () => 0,
      travelTo: () => undefined
    } as unknown as Creep;
    Game.creeps = { b1: creep };

    runCreepBehaviors();

    expect(creep.memory.task?.target).toBe("pile");
    // pickup (step 0) is a gather step: with the store still empty (used stays 0 in this stub),
    // isComplete is false, so nextStep holds at step 0 rather than advancing — proof the loop
    // exited on the first iteration's success rather than continuing to spin.
    expect(creep.memory.task?.step).toBe(0);
  });
});

// harvest (WORK pipeline) and transfer (its own CARRY pipeline) are independent per-tick engine
// actions (docs.screeps.com/simultaneous-actions.html), so a miner standing at a source with a
// container in reach should fire both in the same tick rather than waiting a tick per action.
describe("same-tick co-fire: miner harvest + transfer", () => {
  function minerWithContainer(container: object | undefined): { creep: Creep; transferred: string[] } {
    const transferred: string[] = [];
    const source = { id: "src", energy: 100, pos: sourcePos(5, 5), room: OPEN_TERRAIN };
    const creep = {
      name: "m1",
      spawning: false,
      memory: { role: "miner", task: { step: 0 }, sourceId: "src" },
      store: { getFreeCapacity: () => 0, getUsedCapacity: () => 50 }, // already carrying from a prior tick
      pos: {
        x: 5,
        y: 5,
        findClosestByPath: (list: object[]) => list[0] ?? null,
        inRangeTo: () => true
      },
      room: {
        find: (kind: FindConstant) => (kind === FIND_STRUCTURES && container ? [container] : [])
      },
      harvest: () => 0,
      transfer: (t: { id: string }) => transferred.push(t.id),
      travelTo: () => undefined
    } as unknown as Creep;
    return { creep, transferred };
  }

  it("acts on harvest and also transfers into the container in the same call", () => {
    const container = {
      id: "cont",
      structureType: STRUCTURE_CONTAINER,
      pos: sourcePos(5, 5),
      store: { getFreeCapacity: () => 50, getUsedCapacity: () => 0 }
    };
    const source = { id: "src", energy: 100, pos: sourcePos(5, 5), room: OPEN_TERRAIN };
    stubGame({ objects: { src: source, cont: container } });
    const { creep, transferred } = minerWithContainer(container);
    Game.creeps = { m1: creep };

    runCreepBehaviors();

    expect(transferred).toEqual(["cont"]);
  });

  it("does not attempt a transfer when no container is in reach — no error, no spurious call", () => {
    stubGame({ objects: { src: { id: "src" } } });
    const { creep, transferred } = minerWithContainer(undefined);
    Game.creeps = { m1: creep };

    expect(() => runCreepBehaviors()).not.toThrow();
    expect(transferred).toEqual([]);
  });
});

// Regression for a live-reported bug: empty-carry upgraders looping near a moving hauler instead of
// ever reaching the controller. travelTo keeps one _trav slot per creep, not one per pipeline, so a
// co-fired step that's out of range must never call travelTo — only the primary step may move the
// creep this tick, or its in-flight path gets silently overwritten by the co-fire step's own
// destination, every tick, forever (src/empire/creeps.ts's coFireBonusStep gates on didAct, not acted,
// specifically to prevent this).
describe("co-fire never steals movement from the primary step", () => {
  it("an out-of-range upgrade step travels toward the controller, not toward an also-out-of-range hauler", () => {
    const controller = { id: "ctrl", pos: sourcePos(40, 40) };
    const hauler = {
      id: "haul",
      body: [],
      memory: { role: "hauler" },
      pos: sourcePos(5, 40),
      store: { getUsedCapacity: () => 50, getFreeCapacity: () => 0 }
    };
    stubGame({ objects: { ctrl: controller, haul: hauler } });

    const travelTargets: string[] = [];
    const creep = {
      name: "u1",
      spawning: false,
      memory: { role: "upgrader", task: { step: 0 } },
      store: { getFreeCapacity: () => 25, getUsedCapacity: () => 25 },
      pos: {
        x: 5,
        y: 5,
        findClosestByPath: (list: { id: string }[]) => list[0] ?? null,
        inRangeTo: () => false // never in range of anything — controller or hauler
      },
      room: {
        controller,
        find: (kind: FindConstant) => (kind === FIND_MY_CREEPS ? [hauler] : [])
      },
      upgradeController: () => 0,
      withdraw: () => 0,
      travelTo: (dest: { id?: string }) => {
        travelTargets.push(dest.id ?? "unknown");
      }
    } as unknown as Creep;
    Game.creeps = { u1: creep };

    runCreepBehaviors();

    // Only the primary (upgrade) step's travelTo call should land — the co-fired withdraw-from-hauler
    // step found a real target (hauler has energy) but must not also call travelTo, since it's out of
    // range too and would overwrite the controller-bound path with the hauler's position instead.
    expect(travelTargets).toEqual(["ctrl"]);
  });
});
