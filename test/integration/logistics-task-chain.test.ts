// The tracer bullet for gh #45's Task/fork/parent chaining primitive: standalone infra, not yet wired
// into any live role (Transport/Supply/Steward) — see logistics/task.ts's header and ADR 0008. Proven
// here via a seeded creep driven entirely through the test-only __assignLogisticsTaskChain console hook
// (logistics/testHooks.ts) + main.ts's unconditional runLogisticsTasks, exercising real pickup/transfer
// game calls and real cross-tick Memory persistence — not a hand-built fixture, per the PRD's testing
// decisions (no pure-function seam is left once registration/ranking reads live Game.* state).
//
// The withdraw leg's source is a dropped energy pile, not a container: construction/planner.ts's
// demolish-unwanted pass runs on tick 0 (its interval:100 still matches Game.time===0) and tears down any
// seeded structure that isn't part of the bunker's goal layout — confirmed live, a seeded container at an
// arbitrary tile vanished within one tick. A dropped resource has no such planner ownership.

import { CARRY, CARRY_CAPACITY, CREEP_LIFE_TIME, MOVE, RESOURCE_ENERGY } from "@screeps/common/lib/constants";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot } from "./harness";
import { seedCreeps } from "./seed";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "a 2-task pickup-then-transfer chain runs both legs and clears memory once done, surviving a tick boundary",
  async () => {
    const spawn = (await colony.structures("spawn"))[0];
    await colony.setStore(spawn._id as string, 0);

    // A dropped pile a few tiles from spawn (the pickup source) — real store/pile-bearing game objects,
    // not fixtures, so the executor's creep.pickup/transfer calls are exercised for real.
    const pileX = Math.min(48, (spawn.x as number) + 3);
    const pileY = spawn.y as number;
    await colony.server.world.addRoomObject(colony.room, "energy", pileX, pileY, { energy: 200 });

    await seedCreeps(colony, [
      {
        name: "task_chain_creep",
        role: "hauler",
        memory: { home: colony.room, role: "hauler" },
        body: [CARRY, CARRY, MOVE],
        ttl: CREEP_LIFE_TIME
      }
    ]);

    const pile = (await colony.roomObjects()).find(o => o.type === "energy");
    if (!pile) throw new Error("seeded drop pile not found");

    // Outermost leg first: pick up the pile, then (its `parent`) transfer to the spawn.
    await colony.console(
      `__assignLogisticsTaskChain("task_chain_creep", ${JSON.stringify([
        { kind: "withdraw", targetId: pile._id, resource: RESOURCE_ENERGY },
        { kind: "transfer", targetId: spawn._id, resource: RESOURCE_ENERGY }
      ])})`
    );

    const reachedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsTask?: unknown }> };
      const spawnEnergy = await colony.energyIn("spawn");
      return spawnEnergy > 0 && mem.creeps?.task_chain_creep?.logisticsTask === undefined;
    }, 100);

    expect(reachedTick, "chain never completed and cleared memory within budget").not.toBeNull();

    const spawnEnergy = await colony.energyIn("spawn");
    expect(spawnEnergy).toBeGreaterThan(0);
    expect(spawnEnergy).toBeLessThanOrEqual(CARRY_CAPACITY * 2);

    const remainingPile = (await colony.roomObjects()).find(o => o.type === "energy" && o._id === pile._id);
    const pileAmount = (remainingPile?.energy as number | undefined) ?? 0;
    expect(pileAmount).toBeLessThan(200);
  },
  60_000
);

test(
  "a task whose target vanishes before the creep acts is dropped, not retried forever",
  async () => {
    const spawn = (await colony.structures("spawn"))[0];

    const pileX = Math.max(1, (spawn.x as number) - 3);
    const pileY = spawn.y as number;
    await colony.server.world.addRoomObject(colony.room, "energy", pileX, pileY, { energy: 150 });

    await seedCreeps(colony, [
      {
        name: "task_chain_dead_ref",
        role: "hauler",
        memory: { home: colony.room, role: "hauler" },
        body: [CARRY, CARRY, MOVE],
        ttl: CREEP_LIFE_TIME
      }
    ]);

    const pile = (await colony.roomObjects()).find(o => o.type === "energy" && o.x === pileX && o.y === pileY);
    if (!pile) throw new Error("seeded drop pile not found");

    await colony.console(
      `__assignLogisticsTaskChain("task_chain_dead_ref", ${JSON.stringify([{ kind: "withdraw", targetId: pile._id, resource: RESOURCE_ENERGY }])})`
    );
    // Let the console command land and the task get assigned before the target is pulled out from under it.
    await colony.runTicks(1);
    await colony.removeRoomObject(pile._id as string);

    const clearedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsTask?: unknown }> };
      return mem.creeps?.task_chain_dead_ref?.logisticsTask === undefined;
    }, 20);

    expect(clearedTick, "a task targeting a vanished object was never dropped from memory").not.toBeNull();
  },
  60_000
);
