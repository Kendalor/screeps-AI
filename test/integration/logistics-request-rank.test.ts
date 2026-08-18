// Proves gh #46's LogisticsRequest rate-ranking core: an idle creep picks the best-scoring candidate by
// multiplier * amount / distance (Overmind's dQ/dt shape), not simply the nearest or the largest alone —
// see logistics/request.ts's header and ADR 0008. Standalone: driven entirely through the test-only
// __pickLogisticsRequest console hook (logistics/testHooks.ts), not wired into any live role yet.
//
// Candidates are dropped energy piles, not containers — construction/planner.ts's demolish-unwanted pass
// tears down any seeded structure that isn't part of the bunker's goal layout on tick 0 (confirmed by
// gh #45's logistics-task-chain.test.ts), so a dropped pile is used as the live, ID-bearing, in-range
// target instead; pickBestRequest itself is target-shape-agnostic (`_HasId & {pos}`), so this is a real
// proof of the ranking function, not a stand-in for a different code path.

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
  "an idle creep picks the far-but-large request over the near-but-small one when its rate wins",
  async () => {
    const spawn = (await colony.structures("spawn"))[0];
    const spawnX = spawn.x as number;
    const spawnY = spawn.y as number;

    // Near pile: small amount, right next to the creep's spawn spot — best if distance alone decided.
    const nearX = Math.min(48, spawnX + 2);
    await colony.server.world.addRoomObject(colony.room, "energy", nearX, spawnY, { energy: 50 });

    // Far pile: large amount, several tiles further — should win once amount/distance is priced in
    // (50/2 = 25 vs 2000/8 = 250 — an order of magnitude apart, not a knife-edge tie).
    const farX = Math.min(48, spawnX + 10);
    await colony.server.world.addRoomObject(colony.room, "energy", farX, spawnY, { energy: 2000 });

    await seedCreeps(colony, [
      {
        name: "rank_creep",
        role: "hauler",
        memory: { home: colony.room, role: "hauler" },
        body: [CARRY, MOVE],
        ttl: CREEP_LIFE_TIME
      }
    ]);

    const piles = (await colony.roomObjects()).filter(o => o.type === "energy");
    const near = piles.find(p => p.x === nearX && p.y === spawnY);
    const far = piles.find(p => p.x === farX && p.y === spawnY);
    if (!near || !far) throw new Error("seeded drop piles not found");

    await colony.console(
      `__pickLogisticsRequest("rank_creep", ${JSON.stringify([
        { targetId: near._id, resource: RESOURCE_ENERGY, amount: 50 },
        { targetId: far._id, resource: RESOURCE_ENERGY, amount: 2000 }
      ])})`
    );

    const reachedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsRequestPick?: string }> };
      return mem.creeps?.rank_creep?.logisticsRequestPick !== undefined;
    }, 20);
    expect(reachedTick, "the pick hook never recorded a result").not.toBeNull();

    const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsRequestPick?: string }> };
    expect(mem.creeps?.rank_creep?.logisticsRequestPick).toBe(far._id);
  },
  60_000
);

test(
  "an idle creep picks the near request when amount/distance rates are close, not the merely-larger one",
  async () => {
    await seedCreeps(colony, [
      {
        name: "rank_creep_2",
        role: "hauler",
        memory: { home: colony.room, role: "hauler" },
        body: [CARRY, MOVE],
        ttl: CREEP_LIFE_TIME
      }
    ]);

    // Read the creep's real seeded position back (seedCreeps places it at whatever open tile it finds
    // near spawn, not necessarily on spawn itself) so the distances below are exact, not assumed.
    const creepObj = (await colony.roomObjects()).find(o => o.type === "creep" && o.name === "rank_creep_2");
    if (!creepObj) throw new Error("seeded creep not found");
    const creepX = creepObj.x as number;
    const creepY = creepObj.y as number;

    // Near pile: modest amount, one tile away — rate 100/1 = 100.
    const nearX = Math.min(48, creepX + 1);
    await colony.server.world.addRoomObject(colony.room, "energy", nearX, creepY, { energy: 100 });

    // Far pile: bigger amount, far enough that distance still loses it the rate race — rate 400/8 = 50.
    const farX = Math.min(48, creepX + 8);
    await colony.server.world.addRoomObject(colony.room, "energy", farX, creepY, { energy: 400 });

    const piles = (await colony.roomObjects()).filter(o => o.type === "energy" && o.y === creepY);
    const near = piles.find(p => p.x === nearX);
    const far = piles.find(p => p.x === farX);
    if (!near || !far) throw new Error("seeded drop piles not found");

    await colony.console(
      `__pickLogisticsRequest("rank_creep_2", ${JSON.stringify([
        { targetId: near._id, resource: RESOURCE_ENERGY, amount: 100 },
        { targetId: far._id, resource: RESOURCE_ENERGY, amount: 400 }
      ])})`
    );

    const reachedTick = await colony.runUntil(async () => {
      const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsRequestPick?: string }> };
      return mem.creeps?.rank_creep_2?.logisticsRequestPick !== undefined;
    }, 20);
    expect(reachedTick, "the pick hook never recorded a result").not.toBeNull();

    const mem = (await colony.memory()) as { creeps?: Record<string, { logisticsRequestPick?: string }> };
    expect(mem.creeps?.rank_creep_2?.logisticsRequestPick).toBe(near._id);
  },
  60_000
);
