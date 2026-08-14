// The tracer bullet for drop mining (gh #27): a booted colony spawns a miner from RCL1 with
// no container anywhere in the room, and that miner parks on a source letting energy pile on
// the ground. gh #28 closes the loop: collectors retrieve that pile so the energy reaches spawn.

import { CREEP_LIFE_TIME } from "@screeps/common/lib/constants";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, CheckpointLadder } from "./harness";
import { seedCreeps } from "./seed";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "a fresh RCL1 colony spawns a miner and accumulates a drop pile at a source",
  async () => {
    const ladder = new CheckpointLadder([
      { name: "first creep alive", by: 150 },
      { name: "miner alive", by: 700 },
      { name: "drop pile accumulating", by: 900 }
    ]);

    await colony.runUntil(
      async () => ladder.firstMissed() === null,
      1000,
      async tick => {
        const creeps = await colony.creepCount();
        const miner = await colony.hasRole("miner");
        const drops = (await colony.roomObjects()).filter(o => o.type === "energy");
        await ladder.sample(tick, name => {
          switch (name) {
            case "first creep alive":
              return creeps > 0;
            case "miner alive":
              return miner;
            case "drop pile accumulating":
              return drops.some(d => ((d.energy as number | undefined) ?? 0) > 0);
            default:
              return false;
          }
        });
      }
    );

    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();

    // No container exists anywhere in the room — this is drop mining, not the RCL3+ economy.
    expect((await colony.structures("container")).length).toBe(0);
  },
  180_000
);

// A hauler is seeded directly rather than waited for: hauler quota still gates on containers
// (gh #29) and spawn scheduling is still the fixed priority list (gh #30), neither of which
// gh #28 touches. Seeding isolates what #28 actually owns — a collector's pickup step and the
// worthwhile/claim-cap target resolution — from that unrelated, not-yet-built quota plumbing.
test(
  "a seeded hauler collects a drop pile and delivers it to spawn",
  async () => {
    // Drain spawn down first: a full spawn from bootstrap's own delivery would make the
    // "replenished" checkpoint trivially true without the hauler doing anything.
    const spawn = (await colony.structures("spawn"))[0];
    await colony.setStore(spawn._id as string, 0);

    await seedCreeps(colony, [
      { name: "seed_hauler_0", role: "hauler", body: [CARRY, CARRY, MOVE], ttl: CREEP_LIFE_TIME }
    ]);

    const ladder = new CheckpointLadder([{ name: "spawn energy replenished by the hauler", by: 800 }]);

    await colony.runUntil(
      async () => ladder.firstMissed() === null,
      800,
      async tick => {
        const spawnEnergy = await colony.energyIn("spawn");
        await ladder.sample(tick, name => (name === "spawn energy replenished by the hauler" ? spawnEnergy > 0 : false));
      }
    );

    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();
  },
  180_000
);
