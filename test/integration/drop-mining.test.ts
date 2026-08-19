// The tracer bullet for drop mining (gh #27): a booted colony spawns a miner from RCL1 with
// no container anywhere in the room, and that miner parks on a source letting energy pile on
// the ground. gh #28 closes the loop: collectors retrieve that pile so the energy reaches spawn.

import { CARRY, CREEP_LIFE_TIME, MOVE, RESOURCE_LEMERGIUM } from "@screeps/common/lib/constants";
import { afterAll, beforeAll, expect, test } from "vitest";
import GOAL_JSON from "../../src/construction/Base_2.json";
import { stampLayout } from "../../src/construction/stamp";
import type { GoalLayout } from "../../src/construction/sync";
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

// gh #52's headline acceptance criterion: mineral transport actually happens in a live-bot integration
// run, through the real, live Transport role (behaviors/transportTaskRunner.ts) end to end for the first
// time — not a standalone testHooks.ts console-hook proof like gh #48's own mineral-registration test.
// An extractor requires RCL6 in real play (too deep to grind to naturally here — see mineralMining.ts's
// EXTRACTOR_RCL) and storage requires RCL4 — this jumps the controller straight to RCL6 directly.
//
// Structures are hand-placed as FINISHED structures rather than grinding out the organic build (with no
// builder alive, the bunker's own tower/extension sites permanently monopolise construction/planner.ts's
// FOCUS_SITE_CAP slots — confirmed live while writing this test — so an extractor/container site would
// never even get placed):
//   - storage goes at its exact goal-layout tile (stampLayout against the real anchor, same computation
//     harness.ts's own layoutSpawnPos uses for spawn) — deterministic, no ambiguity, so it's never touched
//     by the demolish-unwanted pass (construction/planner.ts tears down anything NOT part of the goal
//     layout or a real operation claim — an earlier draft that placed storage off-layout got it demolished
//     the very next planner pass).
//   - the extractor goes directly on the mineral's own tile — the ONE tile MineralMining.structures()
//     (and the engine itself) can ever want it at, so it's likewise never demolished.
//   - the container's real claimed tile (MineralMining's own findPath-derived spot) isn't independently
//     computable from this test process (PathFinder is only stubbed/real inside the bundled bot's own
//     engine process, not here) — so it's hand-placed adjacent to the mineral and simply RE-PLACED once
//     after the first demolish-unwanted pass (interval:100 — see kernel/tick.ts) tears the mismatched
//     hand-placement down, rather than fighting to predict the pathed tile exactly. Once the mineral
//     store is hand-set, the real Transport role only needs the container to exist and hold mineral —
//     which claim/tile it happens to sit at is not itself under test here.
test(
  "a mineral container's output actually reaches storage through the live Transport role",
  async () => {
    await colony.setControllerLevel(6, 0);

    const anchor = await colony.anchor();
    if (!anchor) throw new Error("colony has no cached bunker anchor yet");
    const storagePlacement = (GOAL_JSON as GoalLayout).placements.find(p => p.type === "storage");
    if (!storagePlacement) throw new Error("goal layout has no storage placement");
    const [storagePos] = stampLayout([storagePlacement], anchor);
    await colony.addStructure("storage", storagePos.x, storagePos.y, {
      user: colony.bot.id,
      store: {},
      storeCapacity: 200_000,
      hits: 100_000,
      hitsMax: 100_000
    });

    const mineral = (await colony.roomObjects()).find(o => o.type === "mineral");
    if (!mineral) throw new Error("no mineral in this room");
    const mineralX = mineral.x as number;
    const mineralY = mineral.y as number;
    await colony.addStructure("extractor", mineralX, mineralY, { user: colony.bot.id, hits: 500, hitsMax: 500 });

    const containerX = mineralX;
    const containerY = mineralY + 1;
    const placeContainer = () =>
      colony.addStructure("container", containerX, containerY, { store: {}, storeCapacity: 2000, hits: 250_000, hitsMax: 250_000 });
    await placeContainer();

    // Re-place once past the first demolish-unwanted pass (interval:100) — confirmed live that a
    // hand-placed container at a tile not matching MineralMining's own pathed claim survives fine until
    // that pass runs, then gets torn down exactly once; a second placement afterward is never touched
    // again within this test's tick budget (the pass only re-runs every 100 ticks). If it's somehow
    // still standing after 150 ticks (this pass didn't fire, or the tile happened to match a real
    // claim), leave it alone rather than risk placing a duplicate on the same tile.
    const demolished = await colony.runUntil(
      async () => !(await colony.roomObjects()).some(o => o.type === "container" && o.x === containerX && o.y === containerY),
      150
    );
    if (demolished !== null) await placeContainer();

    const container = (await colony.roomObjects()).find(o => o.type === "container" && o.x === containerX && o.y === containerY);
    if (!container) throw new Error("the mineral container was not re-placed");

    // Hand-set the container's mineral store directly (same raw-db shape as harness.ts's own setStore,
    // just keyed by the room's real mineralType rather than energy) — nothing in this scenario can mine
    // this much lemergium/hydrogen naturally in a reasonable tick budget.
    const mineralType = (mineral.mineralType as string) ?? RESOURCE_LEMERGIUM;
    const seededAmount = 1500;
    const { db } = await colony.server.world.load();
    await db["rooms.objects"].update({ _id: container._id }, { $set: { store: { [mineralType]: seededAmount } } });

    await seedCreeps(colony, [
      {
        name: "mineral_transport",
        role: "transport",
        memory: { home: colony.room, role: "transport" },
        body: [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE],
        ttl: CREEP_LIFE_TIME
      }
    ]);

    const deliveredTick = await colony.runUntil(async () => {
      const storageObj = (await colony.structures("storage"))[0];
      const storageMineral = (storageObj?.store as Record<string, number> | undefined)?.[mineralType] ?? 0;
      return storageMineral > 0;
    }, 500);
    expect(deliveredTick, "mineral never reached storage via the live Transport role").not.toBeNull();

    const finalContainer = (await colony.roomObjects()).find(o => o._id === container._id);
    const finalContainerMineral = (finalContainer?.store as Record<string, number> | undefined)?.[mineralType] ?? 0;
    const finalStorage = (await colony.structures("storage"))[0];
    const finalStorageMineral = (finalStorage?.store as Record<string, number> | undefined)?.[mineralType] ?? 0;

    // The container shrank and storage grew — a real transfer happened, not just a coincidental
    // container top-off from somewhere else (nothing else in this scenario produces this mineral).
    expect(finalContainerMineral).toBeLessThan(seededAmount);
    expect(finalStorageMineral).toBeGreaterThan(0);
  },
  120_000
);

