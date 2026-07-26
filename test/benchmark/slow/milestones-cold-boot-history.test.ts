// SLOW benchmark: one continuous cold boot run out to a large tick budget (20,000 ticks),
// recording a full milestone history in one shot rather than stopping at each level like the other
// milestone files do. This is the "how does a whole cold start play out" benchmark: which tick each
// RCL landed on, when the first tower and first storage finished, and the cumulative economy
// (harvested/decayed/spend split) across the entire run.
//
// Lives under test/benchmark/slow/ for the same reason as milestones-rcl3-cold-boot.test.ts: a
// 20k-tick run is far too slow for the standard `npm run bench` set. Run it with:
//
//   npm run bench:slow
//
// Unlike the other milestone files, this test never fails on a missed milestone — a rung that isn't
// reached within the budget just records `null` for that measurement (excluded from future
// baselines, but visible in history) and the run keeps going to the tick budget regardless. The only
// hard failure is "harvested zero energy", which would make every other number meaningless. That is
// the "always passes and keeps a history" benchmark: every run appends a full row to benchmarks.json
// even when a milestone is missed, so the history shows *when* things started going wrong rather than
// just a single pass/fail flip.
//
// Runs in the harness's default room (bunker terrain, spawn on the layout's own spawn tile):
// stubWorld()'s stock rooms cap clearance at 4 vs BUNKER_RADIUS=6, so no anchor would be found.

import { afterAll, beforeAll, expect, test } from "vitest";
import {
  ECONOMY_SPEC,
  economyOf,
  formatResult,
  isRegression,
  recordBenchmark,
  reportBenchmark,
  type BenchmarkSpec
} from "../benchmarks";
import { EnergyMetrics } from "../../integration/energyMetrics";
import { BootedColony, bundleBot } from "../../integration/harness";

const TICK_BUDGET = 20_000;

// Overridable so parallel/driver runs (scripts/bench-slow.mjs, bench-parallel.mjs) can shard to
// separate files — recordBenchmark is an unlocked read-modify-write and concurrent runs sharing
// one file would collide.
const BENCH_OUT = process.env.BENCH_FILE;

// ECONOMY_SPEC's own "ticks" entry means something different everywhere else it's used (time to
// reach one milestone) — here the run always consumes the whole fixed budget, so that key is
// dropped in favour of the per-rung ticks below, each "first tick this held true" and its own
// regression signal (null if the run never reached it, excluded from future baselines but visible).
const { ticks: _unused, ...ECONOMY_ONLY } = ECONOMY_SPEC;
const MILESTONE_SPEC: BenchmarkSpec = {
  ...ECONOMY_ONLY,
  rcl2: { unit: "ticks" },
  rcl3: { unit: "ticks" },
  rcl4: { unit: "ticks" },
  rcl5: { unit: "ticks" },
  towerBuilt: { unit: "ticks" },
  storageBuilt: { unit: "ticks" }
};

let colony: BootedColony;

const energy = new EnergyMetrics();

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "benchmark: cold boot milestone history over 20000 ticks",
  async () => {
    const milestones: Record<string, number | null> = {
      rcl2: null,
      rcl3: null,
      rcl4: null,
      rcl5: null,
      towerBuilt: null,
      storageBuilt: null
    };

    // runUntil resolves the predicate to a tick only when it turns true, and to null if the budget
    // runs out first — but this run is meant to always consume its whole budget, so the real final
    // tick is captured as a side effect here rather than taken from runUntil's return value.
    let lastTick = 0;
    await colony.runUntil(
      async () => false,
      TICK_BUDGET,
      async tick => {
        lastTick = tick;
        await colony.sampleEnergy(energy);
        const ctrl = await colony.controller();
        if (milestones.rcl2 === null && ctrl.level >= 2) milestones.rcl2 = tick;
        if (milestones.rcl3 === null && ctrl.level >= 3) milestones.rcl3 = tick;
        if (milestones.rcl4 === null && ctrl.level >= 4) milestones.rcl4 = tick;
        if (milestones.rcl5 === null && ctrl.level >= 5) milestones.rcl5 = tick;
        if (milestones.towerBuilt === null && (await colony.structures("tower")).length > 0) {
          milestones.towerBuilt = tick;
        }
        if (milestones.storageBuilt === null && (await colony.structures("storage")).length > 0) {
          milestones.storageBuilt = tick;
        }
      }
    );

    // Record + print before any assertion can throw, so every run lands in the committed history —
    // including one that harvested nothing, which the assertion below would otherwise catch first.
    // lastTick itself isn't recorded as a measurement: it's always ~TICK_BUDGET (a fixed run length,
    // not something that regresses), but it's asserted below as a sanity check on the run itself.
    const report = energy.report();
    const result = recordBenchmark(
      "cold-boot-history",
      { ...milestones, ...economyOf(report) },
      MILESTONE_SPEC,
      BENCH_OUT
    );
    reportBenchmark(result);

    expect(lastTick, "the run did not consume its full tick budget").toBeGreaterThanOrEqual(TICK_BUDGET - 1);
    // Without this floor a run that harvested nothing would record a 0 baseline and look stable
    // forever, and every milestone/economy number above would be meaningless noise.
    expect(report.harvested, "no energy was harvested — the milestone history is meaningless").toBeGreaterThan(0);

    // Deliberately not a blanket regression check: a milestone genuinely missed within budget (e.g.
    // RCL5 in a 20k-tick run) is expected, real information for the history, not a bug to fail the
    // build over. Only the economy measurements — always defined once anything was harvested — gate
    // pass/fail here, so this benchmark always produces a history row and only fails on an actual
    // economy regression.
    const economyRegressions = Object.keys(economyOf(report)).flatMap(name => {
      const c = result.get(name);
      return c && isRegression(c) ? [c.measurement] : [];
    });
    expect(economyRegressions, formatResult(result)).toEqual([]);
  },
  1_800_000
);
