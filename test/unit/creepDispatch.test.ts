import { describe, expect, it } from "vitest";
import { ROLES } from "../../src/behaviors/roles";
import { runCreepBehaviors } from "../../src/systems/creeps";
import { stubGame } from "../helpers";
import type { EmpireSnapshot } from "../../src/snapshot/types";

// The dispatch is what makes the lock survive a tick: it stores the target
// runStep used into creep.memory.task.target and hands it back next tick (#23).
// Driven through runCreepBehaviors — the public entry point — rather than the
// private runOne, so the test survives refactors of the dispatch internals.

const EMPTY_SNAPSHOT = { tick: 0, colonies: [] } as EmpireSnapshot;

function siteObj(id: string): object {
  return { id, pos: { x: 10, y: 10 }, progress: 0, progressTotal: 100 };
}

// A builder carrying energy and parked out of range of its site, so it travels
// rather than arriving — the exact situation the lock exists for (a nearer site
// appearing mid-journey). It starts on the role's `build` step (index 3) with a
// half-full store, so the step neither completes nor advances between ticks.
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
    room: { find: () => sites },
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

    runCreepBehaviors(EMPTY_SNAPSHOT);

    expect(creep.memory.task?.target).toBe("siteA");
  });

  it("keeps building the locked site when a nearer one appears mid-journey", () => {
    const first = siteObj("first");
    const nearer = siteObj("nearer");
    stubGame({ objects: { first, nearer } });
    const creep = builder([first]);
    Game.creeps = { b1: creep };

    runCreepBehaviors(EMPTY_SNAPSHOT);
    expect(creep.memory.task?.target).toBe("first");

    // Tick two: a nearer site is now the one a fresh search would return.
    (creep as unknown as { room: { find: () => object[] } }).room.find = () => [nearer, first];
    runCreepBehaviors(EMPTY_SNAPSHOT);

    expect(creep.memory.task?.target).toBe("first");
  });

  it("relocks onto a new target once the locked site is finished", () => {
    const first = siteObj("first");
    const next = siteObj("next");
    stubGame({ objects: { first, next } });
    const creep = builder([first]);
    Game.creeps = { b1: creep };

    runCreepBehaviors(EMPTY_SNAPSHOT);
    expect(creep.memory.task?.target).toBe("first");

    // The site completed: it no longer resolves by id and is gone from the room.
    Game.getObjectById = ((id: string) => (id === "next" ? next : null)) as typeof Game.getObjectById;
    (creep as unknown as { room: { find: () => object[] } }).room.find = () => [next];
    runCreepBehaviors(EMPTY_SNAPSHOT);

    expect(creep.memory.task?.target).toBe("next");
  });
});
