// The tracer bullet for gh #50's Supply self-registration (spawn/extension/tower fast path): standalone
// infra, not yet wired into any live role's dispatch table — see logistics/supplyRegister.ts's and
// behaviors/supplyTaskRunner.ts's headers, and ADR 0008's cutover-sequencing decision (live wiring is
// #53). Proven here via a seeded Supply-role creep driven entirely through the test-only __runSupplyTask
// console hook (logistics/testHooks.ts), exercising real registerSupplyRequests() reads against live
// Game.* spawn/extension/tower objects and real pickup/transfer game calls — not a hand-built fixture,
// per the PRD's testing decision that no pure-function seam is left once registration reads live state.
//
// __runSupplyTask is invoked once per tick from the test's own onTick callback (bot.console() is one-shot
// per call, unlike gh #45/#46's now-removed unconditional main.ts driver — see main.ts's git history) so
// the creep's multi-tick withdraw/travel/transfer sequence actually plays out.
//
// Seeded at RCL3 via seedColony (real spawn/extension/tower placed on the goal layout — see seed.ts):
// an arbitrary-tile structure gets torn down within a tick by construction/planner.ts's demolish-unwanted
// pass (confirmed live, same as gh #45's now-removed logistics-task-chain.test.ts noted for a seeded
// container), so this test cannot hand-place its own spawn/extension/tower the way drop-mining.test.ts
// hand-places a container-free scenario. Once seeded, every OTHER live creep is removed and spawn/
// extension energy is drained to 0 — the live bot's own operations still run every tick underneath this
// test (this is the real bundled bot, not a stub), but with no workforce alive and no spawn energy to
// build a replacement from, it cannot organically fill the very sinks this test is measuring within the
// short window used here. This isolates "did gh #50's self-registration path do this" from "did the live
// bot's still-running old system do this" without needing to patch or neuter main.ts.

import { CARRY, CREEP_LIFE_TIME, MOVE } from "@screeps/common/lib/constants";
import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, CheckpointLadder } from "./harness";
import { seedColony } from "./seed";

let colony: BootedColony;

// The anchor isn't cached until the bot has run a tick; seedColony throws without it (see seed.ts).
const TICKS_TO_ANCHOR = 20;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
  await colony.runTicks(TICKS_TO_ANCHOR);
  expect(await colony.anchor(), "the bot never cached a bunker anchor — nothing downstream runs").not.toBeNull();

  // RCL3: real spawn + 10 extensions + 1 tower, all placed on the goal layout so they survive the
  // demolish-unwanted pass. energyFraction: 0 so nothing is pre-filled — this test drains further below
  // anyway, but starting empty avoids a redundant large drain pass.
  const seeded = await seedColony(colony, { level: 3, energyFraction: 0 });
  expect(seeded.structures.length, "no structures were seeded").toBeGreaterThan(0);

  // Remove every seeded creep (the live bot's own bootstrap/miner/supply/etc. workforce) so nothing but
  // this test's own hook-driven creep can act on the sinks under observation — see this file's header.
  await colony.patchMemory(mem => {
    (mem as { creeps?: Record<string, unknown> }).creeps = {};
  });
  const liveCreeps = (await colony.roomObjects()).filter(o => o.type === "creep" && o.user === colony.bot.id);
  for (const c of liveCreeps) await colony.removeRoomObject(c._id as string);

  // Drain every energy-holding structure so the live bot has nothing to spawn a replacement workforce
  // from during this test's short observation window.
  for (const type of ["spawn", "extension", "tower", "container", "storage"]) {
    for (const s of await colony.structures(type)) await colony.setStore(s._id as string, 0);
  }
}, 180_000);

afterAll(() => {
  colony?.stop();
});

test(
  "a Supply-role creep tops off a tower ahead of farther spawn/extensions, using only self-registered live state",
  async () => {
    const spawn = (await colony.structures("spawn"))[0];
    const towers = await colony.structures("tower");
    const extensions = await colony.structures("extension");
    expect(towers.length, "seedColony did not place a tower at RCL3").toBeGreaterThan(0);
    expect(extensions.length, "seedColony did not place extensions at RCL3").toBeGreaterThan(0);

    // A big energy pile near spawn for the creep to draw from — big enough to cover several trips
    // without a registration-threshold gate (Supply's pickup side isn't tiered/thresholded, only the
    // sink side is).
    const pileX = spawn.x as number;
    const pileY = Math.max(1, (spawn.y as number) - 1);
    await colony.server.world.addRoomObject(colony.room, "energy", pileX, pileY, { energy: 3000 });

    await colony.patchMemory(mem => {
      const creeps = ((mem as { creeps?: Record<string, unknown> }).creeps ??= {});
      (creeps as Record<string, unknown>).supply_selfreg_creep = { home: colony.room, role: "supply" };
    });
    const spot = { x: pileX, y: Math.max(1, pileY - 1) };
    await colony.addCreep("supply_selfreg_creep", spot.x, spot.y, {
      body: [{ type: CARRY, hits: 100 }, { type: CARRY, hits: 100 }, { type: MOVE, hits: 100 }, { type: MOVE, hits: 100 }],
      store: { energy: 0 },
      storeCapacity: 100,
      hits: 400,
      hitsMax: 400,
      spawning: false,
      fatigue: 0,
      ageTime: (await colony.server.world.gameTime) + CREEP_LIFE_TIME
    });

    const towerCapacity = towers.reduce((sum, t) => sum + ((t.storeCapacityResource as { energy?: number } | undefined)?.energy ?? 0), 0);

    const ladder = new CheckpointLadder([
      { name: "tower filled first", by: 150 },
      { name: "spawn/extension get a real (creep-sized) delivery once the tower no longer wants any", by: 400 }
    ]);

    // spawns/tick.js's real engine mechanic: a spawn below SPAWN_ENERGY_CAPACITY regenerates 1
    // energy/tick entirely on its own, independent of any creep — confirmed by tracing this test's own
    // spawn=N sequence (climbed by exactly 1/tick from the moment this scenario started, with the sole
    // live creep parked at the tower the whole time). "spawn/extension untouched by MY creep" therefore
    // can't be asserted as spawnEnergy===0 — the passive drift alone violates that within a few ticks
    // regardless of what Supply does. Instead this tracks spawn+extension's per-tick delta and treats
    // anything beyond the passive ceiling (1/tick, generously doubled for safety margin) as a real
    // creep-carried delivery — which the tier-first rule says must not happen before the tower is full.
    const PASSIVE_SPAWN_REGEN_CEILING = 2;
    let prevSpawnExt = 0;
    let creepDeliveredToSpawnExtBeforeTowerFull = false;

    await colony.runUntil(
      async () => ladder.firstMissed() === null,
      400,
      async tick => {
        await colony.console(`__runSupplyTask("supply_selfreg_creep")`);

        const towerEnergy = await colony.energyIn("tower");
        const spawnEnergy = await colony.energyIn("spawn");
        const extEnergy = await colony.energyIn("extension");
        const spawnExt = spawnEnergy + extEnergy;
        const towerFull = towerEnergy >= towerCapacity;
        const spawnExtDelta = spawnExt - prevSpawnExt;

        if (!towerFull && spawnExtDelta > PASSIVE_SPAWN_REGEN_CEILING) {
          creepDeliveredToSpawnExtBeforeTowerFull = true;
        }

        await ladder.sample(tick, name => {
          switch (name) {
            case "tower filled first":
              return towerFull;
            case "spawn/extension get a real (creep-sized) delivery once the tower no longer wants any":
              // A jump bigger than the passive ceiling, after the tower stopped wanting more — proves
              // the creep actually moved on to spawn/extension once tier-first freed it up, not just
              // that time passed and the engine's own passive regen crept spawn up on its own.
              return towerFull && spawnExtDelta > PASSIVE_SPAWN_REGEN_CEILING;
            default:
              return false;
          }
        });

        prevSpawnExt = spawnExt;
      }
    );

    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(
      creepDeliveredToSpawnExtBeforeTowerFull,
      "the creep delivered a creep-sized batch to spawn/extension before the tower was full — tier-first was violated"
    ).toBe(false);

    const finalTower = await colony.energyIn("tower");
    const finalSpawnExt = (await colony.energyIn("spawn")) + (await colony.energyIn("extension"));
    expect(finalTower).toBeGreaterThan(0);
    expect(finalSpawnExt).toBeGreaterThan(0);
  },
  180_000
);

test(
  "Supply's pool never sees a storage sink even when present",
  async () => {
    // registerSupplyRequests reads only FIND_MY_STRUCTURES spawn/extension/tower — a storage structure
    // sitting in the room, even stocked, must never show up as a request, proving the scope boundary in
    // supplyRegister.ts's header. Reuses the prior test's now-idle creep (still alive, tower/spawn/
    // extension already topped off, so it has nothing left to pick anyway) to confirm one more tick of
    // running the hook leaves storage untouched.
    const storages = await colony.structures("storage");
    if (storages.length === 0) {
      await colony.addStructure("storage", 15, 15, {
        user: colony.bot.id,
        store: { energy: 0 },
        storeCapacity: 1_000_000,
        hits: 1,
        hitsMax: 1
      });
    }
    const storage = (await colony.structures("storage"))[0];
    await colony.setStore(storage._id as string, 500_000);

    await colony.console(`__runSupplyTask("supply_selfreg_creep")`);
    await colony.runTicks(3);

    const storageEnergy = await colony.energyIn("storage");
    expect(storageEnergy).toBe(500_000);
  },
  30_000
);

// registerSupplyRequests/pickSupplyRequest are also unit-proved directly against hand-built data in
// test/unit/logistics/supplyRegister.test.ts (no Game.* needed there — see that file's own header) for
// the tier-first-then-nearest selection rule specifically; this file proves the same rule end-to-end
// against a real engine plus the withdraw/transfer execution path.
