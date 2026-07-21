// Milestone benchmarks for the RCL2 -> RCL3 leg.
//
// milestones.test.ts measures the cold-boot climb: nothing to RCL2, then RCL2
// with its 5 extensions finished. That run ends where this one begins. Running
// this leg from a cold boot too would re-measure the RCL2 climb inside every
// figure and cost tens of thousands of ticks doing it — RCL2->3 alone needs
// 45,000 controller progress against a 2-source room — so these scenarios seed a
// *finished, running* RCL2 colony and measure only the leg that follows:
//
//   rcl3                  — from a finished RCL2 colony to controller level 3.
//   rcl3-buildings-built  — RCL3 *and* every structure the colony wants at RCL3
//                           standing. The real "RCL3 done" line: RCL3 unlocks
//                           the tower, 5 more extensions and (via building.ts's
//                           CONTAINERS_FROM_RCL gate) the source containers that
//                           unblock the miner/hauler economy, so the level alone
//                           says little about whether the colony can use it.
//
// "Finished and running" is the point of seeding through `seedColony` (seed.ts)
// rather than just setting a controller level: the seeded colony starts with
// RCL2's buildings up, the workforce that RCL2 quota actually calls for at
// staggered ages, and part-filled extensions. Seeding the level alone would
// start every run with a total-wipe recovery — runt bodies spawned off the
// spawn's own 300 energy — and the measurements would be dominated by a cold
// start the real colony never performs at this milestone.
//
// Nothing about either state is listed here. The seeded structures come from
// `wantedStructures` and the workforce from `desiredCensus`, both the bot's own
// functions, and the RCL3 target set is the same `wantedStructures` asked at
// level 3. The bunker layout, the CONTROLLER_STRUCTURES caps, the road/container
// gates, the source-biased extension order and the spawn quotas therefore all
// flow through automatically — change any of them and this benchmark moves with
// it rather than measuring a target the bot no longer aims for.
//
// Measurements are the same set milestones.test.ts records, defined exactly as
// energyMetrics.ts documents them, accumulated from the seeded RCL2 start (not
// from a cold boot) so both describe this leg alone. See that file's header for
// what each one means.
//
// Needs bunkerTerrain() for the same reason the other milestones do: stubWorld()
// rooms top out at clearance 4 and cannot host a BUNKER_RADIUS=6 bunker, so no
// anchor is found and nothing downstream of layout planning ever runs.

import { afterAll, beforeAll, expect, test } from "vitest";
import type { PlacedStructure } from "../../src/layouts/stamp";
import { wantedStructures } from "../../src/systems/building";
import {
  BenchmarkSpec,
  formatResult,
  recordBenchmark,
  regressions,
  type BenchResult
} from "./benchmarks";
import { EnergyMetrics, type EnergyReport } from "./energyMetrics";
import { BootedColony, bunkerTerrain, bundleBot, CheckpointLadder } from "./harness";
import { outstanding, seedColony } from "./seed";

// Same interpretation as milestones.test.ts — these measure the same quantities
// at a later pair of milestones.
const SPEC: BenchmarkSpec = {
  ticks: { unit: "ticks" },
  energyHarvestedPerTick: { direction: "higher", unit: "energy/tick" },
  energyWasteFraction: { unit: "fraction of available income" },
  energyDecayed: { unit: "energy" },
  sinkUpgrading: { direction: "higher", unit: "fraction of spend" },
  sinkConstruction: { unit: "fraction of spend" },
  sinkCreeps: { unit: "fraction of spend" }
};

// RCL2 with its buildings up is the *start* state, so the controller sits at
// level 2 with a clean slate of progress — seeding partial progress would
// silently shorten the leg being measured.
const SEED_LEVEL = 2;
const TARGET_LEVEL = 3;

// Ticks run before seeding. The anchor is the bot's own cached decision
// (Memory.colonies[room].anchor, written by snapshot/colony.ts), so it does not
// exist until the bot has run; without it there is no frame to stamp the layout
// onto and `seedColony` throws. A handful of ticks is plenty — the anchor is
// computed on the first snapshot, and nothing meaningful is built in this window.
const TICKS_TO_ANCHOR = 5;

// Port and history file are overridable so several runs of this benchmark can be
// executed concurrently to build up history faster (scripts/bench-parallel.mjs).
// Both must be per-run: the mockup binds a storage port, and `recordBenchmark` is
// an unlocked read-modify-write of one JSON file, so two concurrent runs sharing
// either would collide — one silently dropping the other's entry. The driver
// script gives each worker its own port and shard file, then merges the shards
// into the committed history sequentially.
const PORT = Number(process.env.BENCH_PORT ?? 21087);
const BENCH_OUT = process.env.BENCH_FILE;
// The mockup's server directory defaults to a shared `./server`, into which it
// copies the seed db — concurrent runs clobber each other's database and die
// within seconds, so a parallel worker must be given its own.
const SERVER_DIR = process.env.BENCH_SERVER_DIR;

let colony: BootedColony;

// The RCL3 target set, derived once the colony is seeded and standing at RCL2.
// Captured in beforeAll so both tests judge against one set.
let rcl3Targets: PlacedStructure[] = [];

const energy = new EnergyMetrics();

beforeAll(async () => {
  colony = await BootedColony.boot({
    botCode: bundleBot(),
    port: PORT,
    serverDir: SERVER_DIR,
    terrain: bunkerTerrain(),
    spawnX: 25,
    spawnY: 25
  });

  await colony.runTicks(TICKS_TO_ANCHOR);
  expect(
    await colony.anchor(),
    "the bot never cached a bunker anchor — nothing can be derived from the layout"
  ).not.toBeNull();

  const seeded = await seedColony(colony, { level: SEED_LEVEL });
  expect(seeded.structures.length, "no RCL2 structures were derived — the layout produced an empty set").toBeGreaterThan(0);
  expect(seeded.creeps.length, "no RCL2 workforce was derived — the colony would cold-start instead").toBeGreaterThan(0);
  expect(seeded.energy, "the seeded colony started with no energy — it would recover rather than run").toBeGreaterThan(0);

  // The RCL3 target, from the same planner asked as if the colony were already
  // there: this is the set it will aim for once it arrives. Reduced to what the
  // room does not already satisfy, which is what makes it a *reachable* target —
  // the goal layout wants a spawn on the bunker anchor, but the room's real spawn
  // already fills the single slot RCL3 allows, so a raw target set would sit
  // permanently one structure short of complete (see `outstanding`).
  const snapshotAtRcl3 = { ...(await colony.layoutSnapshot()), controllerLevel: TARGET_LEVEL };
  rcl3Targets = outstanding(
    wantedStructures(snapshotAtRcl3),
    await colony.roomObjects(),
    TARGET_LEVEL
  );
  expect(rcl3Targets.length, "no RCL3 structures were derived — the layout produced an empty set").toBeGreaterThan(0);
}, 180_000);

afterAll(() => {
  colony?.stop();
});

/** Turn an energy report into this run's economy measurements. */
function economyOf(report: EnergyReport): Record<string, number | null> {
  const available = report.harvested + report.wasted;
  const { upgrading, construction, creeps } = report.sinks;
  const spent = upgrading + construction + creeps;
  return {
    energyHarvestedPerTick: report.perTick.harvested,
    energyWasteFraction: available ? report.wasted / available : null,
    energyDecayed: report.decayed,
    sinkUpgrading: spent ? upgrading / spent : null,
    sinkConstruction: spent ? construction / spent : null,
    sinkCreeps: spent ? creeps / spent : null
  };
}

/** Print the run (the numbers are the point) and fail on any regression. */
function check(result: BenchResult): void {
  console.log(formatResult(result));
  const bad = regressions(result);
  expect(bad.map(c => c.measurement), formatResult(result)).toEqual([]);
}

/** How many of `targets` are standing in the room right now. */
async function standing(targets: PlacedStructure[]): Promise<number> {
  const present = new Set((await colony.roomObjects()).map(o => `${o.type}@${o.x},${o.y}`));
  return targets.filter(t => present.has(`${t.type}@${t.x},${t.y}`)).length;
}

test(
  "benchmark: a finished RCL2 colony reaches RCL3",
  async () => {
    const ladder = new CheckpointLadder([
      // The seeded workforce is alive before this test runs — the rung exists to
      // catch a seeding failure (a colony that starts empty and cold-recovers)
      // rather than to time a bootstrap, so the budget only has to be far below
      // what spawning a workforce from scratch would cost. The first sample lands
      // a few ticks in because `runUntil` ticks before it observes.
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

    check(recordBenchmark("rcl3", { ticks: reached, ...economyOf(report) }, SPEC, BENCH_OUT));
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

    // Continues the same world; the tick recorded is absolute (ticks since the
    // seeded RCL2 start), so the measurement answers "how long from a finished
    // RCL2 to a finished RCL3" and stays comparable even if the level-up leg
    // itself gets faster or slower.
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

    check(recordBenchmark("rcl3-buildings-built", { ticks: builtTick, ...economyOf(report) }, SPEC, BENCH_OUT));
  },
  900_000
);
