// Records what a run costs (vs boot-rcl2.test.ts's fixed pass/fail budget) into benchmarks.json,
// comparing against the median of prior runs.
//
//   rcl2                  — cold boot to controller level 2.
//   rcl2-extensions-built — RCL2 with all 5 allowed extensions finished; the real "RCL2 done" line
//                           since the colony only gets a bigger spawn body once they exist.
//
// energyWasteFraction is a fraction, not a per-tick rate, because waste accrues in lumps at
// source regen rather than as a flow. sink{Upgrading,Construction,Creeps} are fractions of spend
// so a longer run doesn't inflate them.
//
// Both run in the harness's default room (bunker terrain, spawn on the layout's own spawn tile):
// stubWorld()'s stock rooms cap clearance at 4 vs BUNKER_RADIUS=6, so no anchor would be found.

import { afterAll, beforeAll, expect, test } from "vitest";
import {
  BenchmarkSpec,
  formatResult,
  recordBenchmark,
  regressions,
  type BenchResult
} from "./benchmarks";
import { EnergyMetrics, type EnergyReport } from "../integration/energyMetrics";
import { BootedColony, bundleBot, CheckpointLadder } from "../integration/harness";

// CONTROLLER_STRUCTURES.extension[2] — the engine's own cap at RCL2.
const EXTENSIONS_AT_RCL2 = 5;

const SPEC: BenchmarkSpec = {
  ticks: { unit: "ticks" },
  energyHarvestedPerTick: { direction: "higher", unit: "energy/tick" },
  energyWasteFraction: { unit: "fraction of available income" },
  energyDecayed: { unit: "energy" },
  sinkUpgrading: { direction: "higher", unit: "fraction of spend" },
  sinkConstruction: { unit: "fraction of spend" },
  sinkCreeps: { unit: "fraction of spend" }
};

// Overridable so parallel runs (scripts/bench-parallel.mjs) can shard to separate files —
// recordBenchmark is an unlocked read-modify-write and concurrent runs sharing one file would collide.
const BENCH_OUT = process.env.BENCH_FILE;

let colony: BootedColony;

const energy = new EnergyMetrics();

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

// One booted colony serves both benchmarks — the extension milestone is downstream of RCL2, so
// this test's RCL2 run leaves the world exactly where the next one picks up.
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
      // Bunker anchor optimises for controller proximity, so it starts colonies further from
      // sources — the long opening round trip delays first delivery, budgeted at ~600 for that.
      { name: "controller upgrading", by: 700 },
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
    // Without this floor a run that harvested nothing would record a 0 baseline and look stable forever.
    expect(report.harvested, "no energy was harvested — the economy measurements are meaningless").toBeGreaterThan(0);

    check(recordBenchmark("rcl2", { ticks: rcl2Tick, ...economyOf(report) }, SPEC, BENCH_OUT));
  },
  300_000
);

test(
  "benchmark: RCL2 with all extensions built",
  async () => {
    expect(rcl2Tick, "RCL2 was never reached — extension milestone cannot be measured").not.toBeNull();

    // Tick recorded is absolute (since cold boot), not relative to RCL2, so it stays comparable
    // even if the RCL2 leg itself gets faster or slower.
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

    check(recordBenchmark("rcl2-extensions-built", { ticks: builtTick, ...economyOf(report) }, SPEC, BENCH_OUT));
  },
  600_000
);
