// SLOW milestone benchmarks: a *cold boot* from an empty room all the way to RCL3, and then to
// every structure the colony wants at RCL3. This lives under test/benchmark/slow/ rather than
// alongside the other milestones on purpose — the whole RCL0->2->3 climb is ~10x the seeded
// RCL2->3 leg (milestones-rcl3-from-seed.test.ts), so it does NOT belong in `npm run bench`.
// It has its own command instead:
//
//   npm run bench:slow
//
// scripts/bench.mjs reads test/benchmark/ non-recursively, so a file in this subdirectory is
// already excluded from the standard run; scripts/bench-slow.mjs points a worker at this
// subdirectory explicitly. Both share the same benchmarks.json history, measurement set and
// median-baseline machinery (checkBenchmark/economyOf, see ../benchmarks.ts) as every other
// milestone — only the starting conditions (a genuine cold boot) and tick budgets differ.
//
//   rcl3-cold-boot            — cold boot from an empty room to controller level 3. Distinct from
//                               the seeded `rcl3` key: this figure includes the entire RCL0->2 leg,
//                               so the two are not comparable and keep separate histories.
//   rcl3-buildings-cold-boot  — that same cold boot carried on until every structure the colony
//                               wants at RCL3 is standing (tower, extensions and the source
//                               containers the miner/hauler economy needs).
//
// Runs in the harness's default room (bunker terrain, spawn on the layout's own spawn tile):
// stubWorld()'s stock rooms cap clearance at 4 vs BUNKER_RADIUS=6, so no anchor would be found.

import { afterAll, beforeAll, expect, test } from "vitest";
import type { PlacedStructure } from "../../../src/layouts/stamp";
import { claimsOf, wantedStructures } from "../../../src/colony/building";
import { operationsFor } from "../../../src/operations";
import { assertNoRegression, ECONOMY_SPEC, economyOf, recordBenchmark, reportBenchmark } from "../benchmarks";
import { EnergyMetrics } from "../../integration/energyMetrics";
import { BootedColony, bundleBot, CheckpointLadder } from "../../integration/harness";
import { outstanding } from "../../integration/seed";

const TARGET_LEVEL = 3;

// Overridable so parallel/driver runs (scripts/bench-slow.mjs, bench-parallel.mjs) can shard to
// separate files — recordBenchmark is an unlocked read-modify-write and concurrent runs sharing
// one file would collide.
const BENCH_OUT = process.env.BENCH_FILE;

let colony: BootedColony;

const energy = new EnergyMetrics();

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

// One booted colony serves both benchmarks — the buildings milestone is downstream of RCL3, so
// this test's RCL3 run leaves the world exactly where the next one picks up.
let rcl3Tick: number | null = null;

// Derived once the room actually reaches RCL3 (not seeded), so the buildings test judges against
// the structures the layout wants for the room as it really stands.
let rcl3Targets: PlacedStructure[] = [];

test(
  "benchmark: cold boot reaches RCL3",
  async () => {
    const ladder = new CheckpointLadder([
      { name: "first creep alive", by: 150 },
      // Bunker anchor optimises for controller proximity, so it starts colonies further from
      // sources — the long opening round trip delays first delivery, budgeted at ~600 for that.
      { name: "controller upgrading", by: 700 },
      { name: "RCL2", by: 1200 },
      { name: "RCL3", by: 12_000 }
    ]);

    rcl3Tick = await colony.runUntil(
      async () => (await colony.controller()).level >= TARGET_LEVEL,
      15_000,
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
            case "RCL3":
              return ctrl.level >= TARGET_LEVEL;
            default:
              return false;
          }
        });
      }
    );

    // Record + print every run first — before any assertion can throw — so a run that missed the
    // milestone still lands in the committed history (with ticks: null, excluded from future baselines
    // but kept visible). Only then do the pass/fail assertions run.
    const report = energy.report();
    const result = recordBenchmark("rcl3-cold-boot", { ticks: rcl3Tick, ...economyOf(report) }, ECONOMY_SPEC, BENCH_OUT);
    reportBenchmark(result);

    // Derive the RCL3 target set from the room as it actually stands now. Reduced by `outstanding`
    // to what the room doesn't already satisfy (e.g. the spawn slot, already filled), so the next
    // test's target is reachable rather than waiting forever on something already built or not allowed.
    const snapshotAtRcl3 = { ...(await colony.layoutSnapshot()), controllerLevel: TARGET_LEVEL };
    rcl3Targets = outstanding(
      wantedStructures(snapshotAtRcl3, claimsOf(snapshotAtRcl3, operationsFor(snapshotAtRcl3.name))),
      await colony.roomObjects(),
      TARGET_LEVEL
    );

    expect(ladder.firstMissed(), `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(rcl3Tick, "RCL3 never reached within 15000 ticks of a cold boot").not.toBeNull();
    // Without this floor a run that harvested nothing would record a 0 baseline and look stable forever.
    expect(report.harvested, "no energy was harvested — the economy measurements are meaningless").toBeGreaterThan(0);
    expect(rcl3Targets.length, "no RCL3 structures were derived — the layout produced an empty set").toBeGreaterThan(0);
    assertNoRegression(result);
  },
  1_800_000
);

/** How many of `targets` are standing in the room right now. */
async function standing(targets: PlacedStructure[]): Promise<number> {
  const present = new Set((await colony.roomObjects()).map(o => `${o.type}@${o.x},${o.y}`));
  return targets.filter(t => present.has(`${t.type}@${t.x},${t.y}`)).length;
}

test(
  "benchmark: cold boot with all RCL3 buildings built",
  async () => {
    // Tick recorded is absolute (since cold boot), not relative to RCL3, so it stays comparable even
    // if the level-up leg itself gets faster or slower. When the target set is empty (RCL3 never
    // reached, nothing derived) standing() >= 0 is immediately true; otherwise a miss just times out
    // to builtTick: null — either way the run is still recorded, so every run lands in history.
    const builtTick = await colony.runUntil(
      async () => (await standing(rcl3Targets)) >= rcl3Targets.length,
      20_000,
      () => colony.sampleEnergy(energy)
    );

    // Record + print before asserting, so a missed milestone is recorded (ticks: null) rather than dropped.
    const report = energy.report();
    const result = recordBenchmark(
      "rcl3-buildings-cold-boot",
      { ticks: builtTick, ...economyOf(report) },
      ECONOMY_SPEC,
      BENCH_OUT
    );
    reportBenchmark(result);

    expect(rcl3Tick, "RCL3 was never reached — the buildings milestone cannot be measured").not.toBeNull();
    expect(
      rcl3Targets.length,
      "no RCL3 target set was derived — the buildings milestone cannot be measured"
    ).toBeGreaterThan(0);
    const built = await standing(rcl3Targets);
    expect(
      builtTick,
      `only ${built}/${rcl3Targets.length} RCL3 structures finished within 20000 ticks of RCL3`
    ).not.toBeNull();
    expect(report.harvested, "no energy was harvested — the economy measurements are meaningless").toBeGreaterThan(0);
    assertNoRegression(result);
  },
  1_800_000
);
