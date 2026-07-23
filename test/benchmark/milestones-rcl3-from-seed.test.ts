// Benchmarks the RCL2 -> RCL3 leg, seeded from a finished RCL2 colony (via seedColony) rather than
// a cold boot: RCL2->3 alone needs 45,000 controller progress against a 2-source room, and seeding
// only the controller level would start every run with a total-wipe recovery instead. Shares its
// measurement set and printing with every other file in test/benchmark/ via checkBenchmark/economyOf
// (see benchmarks.ts) — only the checkpoint ladder and starting conditions differ between milestones.
//
//   rcl3                  — from a finished RCL2 colony to controller level 3.
//   rcl3-buildings-built  — RCL3 *and* every structure the colony wants at RCL3 standing (the real
//                           "RCL3 done" line — RCL3 also unlocks the tower, extensions and the
//                           source containers the miner/hauler economy needs).
//
// Runs in the harness's default room (bunker terrain, spawn on layout's own spawn tile).

import { afterAll, beforeAll, expect, test } from "vitest";
import type { PlacedStructure } from "../../src/layouts/stamp";
import { wantedStructures } from "../../src/systems/building";
import { operationsFor } from "../../src/operations";
import { checkBenchmark, ECONOMY_SPEC, economyOf, recordBenchmark } from "./benchmarks";
import { EnergyMetrics } from "../integration/energyMetrics";
import { BootedColony, bundleBot, CheckpointLadder } from "../integration/harness";
import { outstanding, seedColony } from "../integration/seed";

// Clean slate of progress at the start level — seeding partial progress would shorten the measured leg.
const SEED_LEVEL = 2;
const TARGET_LEVEL = 3;

// The anchor (Memory.colonies[room].anchor) doesn't exist until the bot has run at least one tick;
// without it there's no frame to stamp the layout onto and seedColony throws.
const TICKS_TO_ANCHOR = 5;

// Overridable so parallel runs (scripts/bench-parallel.mjs) can shard to separate files —
// recordBenchmark is an unlocked read-modify-write and concurrent runs sharing one file would collide.
const BENCH_OUT = process.env.BENCH_FILE;

let colony: BootedColony;

// Derived once the colony is seeded at RCL2, so both tests judge against the same target set.
let rcl3Targets: PlacedStructure[] = [];

const energy = new EnergyMetrics();

beforeAll(async () => {
  // Default room and spawn placement (harness.ts) — an off-layout spawn would quietly
  // benchmark a room the layout was never designed for.
  colony = await BootedColony.boot({ botCode: bundleBot() });

  await colony.runTicks(TICKS_TO_ANCHOR);
  expect(
    await colony.anchor(),
    "the bot never cached a bunker anchor — nothing can be derived from the layout"
  ).not.toBeNull();

  const seeded = await seedColony(colony, { level: SEED_LEVEL });
  expect(seeded.structures.length, "no RCL2 structures were derived — the layout produced an empty set").toBeGreaterThan(0);
  expect(seeded.creeps.length, "no RCL2 workforce was derived — the colony would cold-start instead").toBeGreaterThan(0);
  expect(seeded.energy, "the seeded colony started with no energy — it would recover rather than run").toBeGreaterThan(0);

  // Reduced by `outstanding` to what the room doesn't already satisfy (e.g. the spawn slot,
  // already filled), so the target is reachable rather than waiting forever on a structure
  // the colony is not allowed to build.
  const snapshotAtRcl3 = { ...(await colony.layoutSnapshot()), controllerLevel: TARGET_LEVEL };
  rcl3Targets = outstanding(
    wantedStructures(
      snapshotAtRcl3,
      operationsFor(snapshotAtRcl3.name).flatMap(op => op.structures(snapshotAtRcl3))
    ),
    await colony.roomObjects(),
    TARGET_LEVEL
  );
  expect(rcl3Targets.length, "no RCL3 structures were derived — the layout produced an empty set").toBeGreaterThan(0);
}, 180_000);

afterAll(() => {
  colony?.stop();
});

/** How many of `targets` are standing in the room right now. */
async function standing(targets: PlacedStructure[]): Promise<number> {
  const present = new Set((await colony.roomObjects()).map(o => `${o.type}@${o.x},${o.y}`));
  return targets.filter(t => present.has(`${t.type}@${t.x},${t.y}`)).length;
}

test(
  "benchmark: a finished RCL2 colony reaches RCL3",
  async () => {
    const ladder = new CheckpointLadder([
      // Catches a seeding failure (empty colony cold-recovering) rather than timing a bootstrap.
      { name: "workforce alive", by: 50 },
      { name: "RCL3", by: 30_000 }
    ]);

    const reached = await colony.runUntil(
      async () => (await colony.controller()).level >= TARGET_LEVEL,
      35_000,
      async tick => {
        await colony.sampleEnergy(energy);
        const ctrl = await colony.controller();
        const creeps = await colony.creepCount();
        await ladder.sample(tick, name => {
          switch (name) {
            case "workforce alive":
              return creeps > 0;
            case "RCL3":
              return ctrl.level >= TARGET_LEVEL;
            default:
              return false;
          }
        });
      }
    );

    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(reached, "RCL3 never reached within 35000 ticks of a finished RCL2").not.toBeNull();

    const report = energy.report();
    // Sanity floor before comparing rates: a run that harvested nothing would
    // otherwise record a 0 baseline and look stable forever.
    expect(report.harvested, "no energy was harvested — the economy measurements are meaningless").toBeGreaterThan(0);

    checkBenchmark(recordBenchmark("rcl3", { ticks: reached, ...economyOf(report) }, ECONOMY_SPEC, BENCH_OUT));
  },
  900_000
);

test(
  "benchmark: RCL3 with all required buildings built",
  async () => {
    expect(
      (await colony.controller()).level,
      "RCL3 was never reached — the building milestone cannot be measured"
    ).toBeGreaterThanOrEqual(TARGET_LEVEL);

    // Tick recorded is absolute (since the seeded RCL2 start), so it stays comparable
    // even if the level-up leg itself gets faster or slower.
    const builtTick = await colony.runUntil(
      async () => (await standing(rcl3Targets)) >= rcl3Targets.length,
      20_000,
      () => colony.sampleEnergy(energy)
    );

    const built = await standing(rcl3Targets);
    expect(
      builtTick,
      `only ${built}/${rcl3Targets.length} RCL3 structures finished within 20000 ticks of RCL3`
    ).not.toBeNull();

    const report = energy.report();
    expect(report.harvested, "no energy was harvested — the economy measurements are meaningless").toBeGreaterThan(0);

    checkBenchmark(
      recordBenchmark("rcl3-buildings-built", { ticks: builtTick, ...economyOf(report) }, ECONOMY_SPEC, BENCH_OUT)
    );
  },
  900_000
);
