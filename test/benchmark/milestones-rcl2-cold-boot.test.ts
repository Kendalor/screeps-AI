// One milestone file among several in test/benchmark/ (see also milestones-rcl3-from-seed.test.ts).
// Each records a leg of colony growth into the shared benchmarks.json history, comparing against
// the median of prior runs, and all share their measurement set and detail printing via
// checkBenchmark/economyOf (see benchmarks.ts) — only the checkpoint ladder and starting
// conditions differ between milestones. To add a new one, add a file here following this shape.
//
//   rcl2                  — cold boot to controller level 2.
//   rcl2-extensions-built — RCL2 with all 5 allowed extensions finished; the real "RCL2 done" line
//                           since the colony only gets a bigger spawn body once they exist.
//
// Runs in the harness's default room (bunker terrain, spawn on the layout's own spawn tile):
// stubWorld()'s stock rooms cap clearance at 4 vs BUNKER_RADIUS=6, so no anchor would be found.

import { afterAll, beforeAll, expect, test } from "vitest";
import { assertNoRegression, ECONOMY_SPEC, economyOf, recordBenchmark, reportBenchmark } from "./benchmarks";
import { EnergyMetrics } from "../integration/energyMetrics";
import { BootedColony, bundleBot, CheckpointLadder } from "../integration/harness";

// CONTROLLER_STRUCTURES.extension[2] — the engine's own cap at RCL2.
const EXTENSIONS_AT_RCL2 = 5;

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

    // Record + print every run first — before any assertion can throw — so a run that missed the
    // milestone still lands in the committed history (with ticks: null, which the recorder excludes
    // from future baselines but keeps visible). Only then do the pass/fail assertions run.
    const report = energy.report();
    const result = recordBenchmark("rcl2", { ticks: rcl2Tick, ...economyOf(report) }, ECONOMY_SPEC, BENCH_OUT);
    reportBenchmark(result);

    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(rcl2Tick, "RCL2 never reached within 1500 ticks").not.toBeNull();
    // Without this floor a run that harvested nothing would record a 0 baseline and look stable forever.
    expect(report.harvested, "no energy was harvested — the economy measurements are meaningless").toBeGreaterThan(0);
    assertNoRegression(result);
  },
  300_000
);

test(
  "benchmark: RCL2 with all extensions built",
  async () => {
    // Tick recorded is absolute (since cold boot), not relative to RCL2, so it stays comparable
    // even if the RCL2 leg itself gets faster or slower. When RCL2 was never reached, this leg just
    // times out to builtTick: null — still recorded, so every run lands in history.
    const builtTick = await colony.runUntil(
      async () => (await colony.structures("extension")).length >= EXTENSIONS_AT_RCL2,
      6000,
      () => colony.sampleEnergy(energy)
    );

    // Record + print before asserting, so a missed milestone is recorded (ticks: null) rather than
    // dropped when an assertion throws.
    const report = energy.report();
    const result = recordBenchmark(
      "rcl2-extensions-built",
      { ticks: builtTick, ...economyOf(report) },
      ECONOMY_SPEC,
      BENCH_OUT
    );
    reportBenchmark(result);

    expect(rcl2Tick, "RCL2 was never reached — extension milestone cannot be measured").not.toBeNull();
    const built = (await colony.structures("extension")).length;
    expect(
      builtTick,
      `only ${built}/${EXTENSIONS_AT_RCL2} extensions finished within 6000 ticks of RCL2`
    ).not.toBeNull();
    expect(report.harvested, "no energy was harvested — the economy measurements are meaningless").toBeGreaterThan(0);
    assertNoRegression(result);
  },
  600_000
);
