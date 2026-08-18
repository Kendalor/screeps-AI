// Proves gh #47's buffer-detour route evaluation: pickBestRoute (logistics/route.ts) scores a direct
// route against via-storage/via-terminal detour routes and picks whichever yields the better
// multiplier*amount/distance rate, matching ADR 0008's ported bufferChoices() decision. Standalone: driven
// entirely through the test-only __pickLogisticsRoute console hook (logistics/testHooks.ts), not wired
// into any live role yet — same harness pattern as gh #46's logistics-request-rank.test.ts.
//
// Storage/terminal are seeded well after tick 0 and the whole test finishes in well under 100 ticks, so
// construction/planner.ts's demolish-unwanted pass (interval:100 — see kernel/tick.ts) never gets a
// chance to tear down an off-layout seeded structure before the assertions run.

import { CARRY, CREEP_LIFE_TIME, MOVE, RESOURCE_ENERGY } from "@screeps/common/lib/constants";
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
  "a via-storage detour wins when it yields a strictly better rate than the direct route",
  async () => {
    await seedCreeps(colony, [
      {
        name: "detour_creep",
        role: "hauler",
        memory: { home: colony.room, role: "hauler" },
        body: [CARRY, CARRY, MOVE],
        ttl: CREEP_LIFE_TIME
      }
    ]);
    const creepObj = (await colony.roomObjects()).find(o => o.type === "creep" && o.name === "detour_creep");
    if (!creepObj) throw new Error("seeded creep not found");
    const creepX = creepObj.x as number;
    const creepY = creepObj.y as number;

    // Target (e.g. a controller battery/upgrade site stand-in) wants 100 energy. The creep starts empty
    // (seedCreeps gives it no carried energy), so the direct route can deliver 0 — nothing to give,
    // regardless of distance (route.ts's directRoute caps deliverable amount by what's already carried,
    // never by full carry capacity). Only a route that stops to load up first can deliver anything at all,
    // which is exactly the mechanical reason a buffer detour can strictly beat a direct route here.
    const targetX = Math.max(2, creepX - 20);
    await colony.addStructure("container", targetX, creepY, { store: { energy: 0 } });

    // Storage sits right next to the creep and is stocked with plenty of energy: the detour lets the
    // creep load a full carry there before continuing to target, so it delivers > 0 (score > 0) where
    // direct delivers exactly 0 (score 0) — a strictly better rate by construction, not a knife-edge tie.
    const storageX = Math.min(48, creepX + 1);
    await colony.addStructure("storage", storageX, creepY, {
      user: colony.bot.id,
      store: { energy: 100_000 },
      storeCapacity: 1_000_000
    });

    const objects = await colony.roomObjects();
    const target = objects.find(o => o.type === "container" && o.x === targetX && o.y === creepY);
    const storage = objects.find(o => o.type === "storage" && o.x === storageX && o.y === creepY);
    if (!target || !storage) throw new Error("seeded target/storage not found");

    await colony.console(
      `__pickLogisticsRoute("detour_creep", "${target._id}", ${JSON.stringify(RESOURCE_ENERGY)}, 100, ${JSON.stringify([storage._id])})`
    );

    const reachedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsRoutePick?: string[] }> };
      return mem.creeps?.detour_creep?.logisticsRoutePick !== undefined;
    }, 20);
    expect(reachedTick, "the route hook never recorded a result").not.toBeNull();

    const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsRoutePick?: string[] }> };
    const legs = mem.creeps?.detour_creep?.logisticsRoutePick;
    // Outermost/current task first: withdraw-at-storage, then transfer-at-target.
    expect(legs).toEqual([storage._id, target._id]);
  },
  60_000
);

test(
  "the direct route wins (no detour) when the creep already carries what the target needs",
  async () => {
    await seedCreeps(colony, [
      {
        name: "direct_creep",
        role: "hauler",
        memory: { home: colony.room, role: "hauler" },
        body: [CARRY, CARRY, MOVE],
        ttl: CREEP_LIFE_TIME
      }
    ]);
    const creepObj = (await colony.roomObjects()).find(o => o.type === "creep" && o.name === "direct_creep");
    if (!creepObj) throw new Error("seeded creep not found");
    const creepX = creepObj.x as number;
    const creepY = creepObj.y as number;
    await colony.setStore(creepObj._id as string, 100); // already carrying enough to satisfy the request directly

    // Target is close; storage is placed deliberately far away, on the opposite side, so a detour through
    // it is strictly worse on distance with no offsetting amount gain (the creep already carries the full
    // 100 the request wants, so the buffer route can't deliver any more than direct already can).
    const targetX = Math.min(48, creepX + 2);
    await colony.addStructure("container", targetX, creepY, { store: { energy: 0 } });

    const storageX = Math.max(2, creepX - 15);
    await colony.addStructure("storage", storageX, creepY, {
      user: colony.bot.id,
      store: { energy: 100_000 },
      storeCapacity: 1_000_000
    });

    const objects = await colony.roomObjects();
    const target = objects.find(o => o.type === "container" && o.x === targetX && o.y === creepY);
    const storage = objects.find(o => o.type === "storage" && o.x === storageX && o.y === creepY);
    if (!target || !storage) throw new Error("seeded target/storage not found");

    await colony.console(
      `__pickLogisticsRoute("direct_creep", "${target._id}", ${JSON.stringify(RESOURCE_ENERGY)}, 100, ${JSON.stringify([storage._id])})`
    );

    const reachedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsRoutePick?: string[] }> };
      return mem.creeps?.direct_creep?.logisticsRoutePick !== undefined;
    }, 20);
    expect(reachedTick, "the route hook never recorded a result").not.toBeNull();

    const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsRoutePick?: string[] }> };
    const legs = mem.creeps?.direct_creep?.logisticsRoutePick;
    // Direct route: a single transfer leg, no buffer stop.
    expect(legs).toEqual([target._id]);
  },
  60_000
);
