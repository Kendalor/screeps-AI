// Milestone benchmarks: what a run costs, recorded so runs are comparable.
//
// boot-rcl2.test.ts asserts the RCL2 climb happens inside a fixed budget — a
// pass/fail gate. These scenarios ask the other question: *what did it cost*
// this time, and is that better or worse than the last runs? Each records one
// entry per run into the committed `benchmarks.json` (last 10 runs per
// benchmark) and fails on a material regression against the median of the prior
// runs. Budgets here are the outer sanity bound; the benchmark is the signal.
//
// Two benchmarks, each carrying every measurement of that run in one entry, so
// figures observed together stay together — a slow run and the harvest rate
// that explains it sit on the same line:
//
//   rcl2                  — cold boot to controller level 2. The early economic
//                           climb: bootstrap spawning, harvest, upgrade.
//   rcl2-extensions-built — RCL2 *and* all 5 extensions RCL2 allows finished.
//                           This is the one that matters for throughput: the
//                           colony only gets a bigger spawn body once the
//                           extensions exist, so this is the real "RCL2 done"
//                           line. Exercises planning -> site placement -> build.
//
// Measurements on each (energy figures defined exactly as energyMetrics.ts
// documents them, accumulated from the cold boot up to that milestone):
//   ticks                     — ticks to reach the milestone.
//   energyHarvestedPerTick    — source energy actually drained per tick: the
//                               colony's realised income. HIGHER is better.
//   energyWasteFraction       — wasted / (harvested + wasted), where "wasted" is
//                               energy still sitting in a source at its regen
//                               reset: income no miner drained in time. A
//                               fraction rather than a per-tick rate because
//                               waste accrues in lumps at regen, not as a flow —
//                               dividing it by ticks yields figures above the
//                               theoretical income cap and means nothing.
//   energyDecayed             — dropped energy that vanished unclaimed.
//   sink{Upgrading,Construction,Creeps} — the *distribution*: where the energy
//                               that was spent actually went, as a fraction of
//                               the three sinks. Fractions rather than totals so
//                               a longer run doesn't inflate them. This is the
//                               diagnostic half: a drop in harvest says the
//                               economy got worse, the split says where it went.
//
// Both need bunkerTerrain(): stubWorld()'s stock rooms top out at clearance 4
// and cannot host a BUNKER_RADIUS=6 bunker, so no anchor is ever found and no
// extension site is ever placed (see harness.bunkerTerrain).

import { afterAll, beforeAll, expect, test } from "vitest";
import {
  BenchmarkSpec,
  formatResult,
  recordBenchmark,
  regressions,
  type BenchResult
} from "./benchmarks";
import { EnergyMetrics, type EnergyReport } from "./energyMetrics";
import { BootedColony, bunkerTerrain, bundleBot, CheckpointLadder } from "./harness";

// CONTROLLER_STRUCTURES.extension[2] — the engine's own cap at RCL2.
const EXTENSIONS_AT_RCL2 = 5;

// Shared by both benchmarks: they measure the same quantities at different
// milestones, so the interpretation of each measurement is identical.
const SPEC: BenchmarkSpec = {
  ticks: { unit: "ticks" },
  energyHarvestedPerTick: { direction: "higher", unit: "energy/tick" },
  energyWasteFraction: { unit: "fraction of available income" },
  energyDecayed: { unit: "energy" },
  // Upgrading is the sink that grows the colony, so a bigger share is better;
  // the other two are costs, so a rising share is the regression.
  sinkUpgrading: { direction: "higher", unit: "fraction of spend" },
  sinkConstruction: { unit: "fraction of spend" },
  sinkCreeps: { unit: "fraction of spend" }
};

let colony: BootedColony;

// One accounting spans both milestones: each benchmark reports the economy as
// it stood from the cold boot up to that point.
const energy = new EnergyMetrics();

beforeAll(async () => {
  colony = await BootedColony.boot({
    botCode: bundleBot(),
    port: 21085,
    terrain: bunkerTerrain(),
    spawnX: 25,
    spawnY: 25
  });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

// One booted colony serves both benchmarks: the extension milestone is strictly
// downstream of RCL2, so measuring in one continuous run is both cheaper and
// truer to how the colony actually develops. Vitest runs tests in file order,
// so the RCL2 test leaves the world exactly where the second picks up.
let rcl2Tick: number | null = null;

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

test(
  "benchmark: cold boot reaches RCL2",
  async () => {
    const ladder = new CheckpointLadder([
      { name: "first creep alive", by: 150 },
      { name: "controller upgrading", by: 500 },
      { name: "RCL2", by: 1200 }
    ]);

    rcl2Tick = await colony.runUntil(
      async () => (await colony.controller()).level >= 2,
      1500,
      async tick => {
        await colony.sampleEnergy(energy);
        const ctrl = await colony.controller();
        const creeps = await colony.creepCount();
        await ladder.sample(tick, name => {
          switch (name) {
            case "first creep alive":
              return creeps > 0;
            case "controller upgrading":
              return ctrl.progress > 0;
            case "RCL2":
              return ctrl.level >= 2;
            default:
              return false;
          }
        });
      }
    );

    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(rcl2Tick, "RCL2 never reached within 1500 ticks").not.toBeNull();

    const report = energy.report();
    // Sanity floor before comparing rates: a run that harvested nothing would
    // otherwise record a 0 baseline and look stable forever.
    expect(report.harvested, "no energy was harvested — the economy measurements are meaningless").toBeGreaterThan(0);

    check(recordBenchmark("rcl2", { ticks: rcl2Tick, ...economyOf(report) }, SPEC));
  },
  300_000
);

test(
  "benchmark: RCL2 with all extensions built",
  async () => {
    expect(rcl2Tick, "RCL2 was never reached — extension milestone cannot be measured").not.toBeNull();

    // Continues the same world. The tick recorded is absolute (ticks since the
    // cold boot), not relative to RCL2, so the measurement answers "how long
    // from nothing to a fully-extended RCL2 colony" and stays comparable even if
    // the RCL2 leg itself gets faster or slower.
    const builtTick = await colony.runUntil(
      async () => (await colony.structures("extension")).length >= EXTENSIONS_AT_RCL2,
      6000,
      () => colony.sampleEnergy(energy)
    );

    const built = (await colony.structures("extension")).length;
    expect(
      builtTick,
      `only ${built}/${EXTENSIONS_AT_RCL2} extensions finished within 6000 ticks of RCL2`
    ).not.toBeNull();

    const report = energy.report();
    expect(report.harvested, "no energy was harvested — the economy measurements are meaningless").toBeGreaterThan(0);

    check(recordBenchmark("rcl2-extensions-built", { ticks: builtTick, ...economyOf(report) }, SPEC));
  },
  600_000
);
