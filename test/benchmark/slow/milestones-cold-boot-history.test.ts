// SLOW benchmark: one continuous cold boot run out to a large tick budget (20,000 ticks),
// recording a full milestone history in one shot rather than stopping at each level like the other
// milestone files do. This is the "how does a whole cold start play out" benchmark: which tick each
// RCL landed on, when the first tower and first storage finished, the cumulative economy
// (harvested/decayed/spend split) across the entire run, and — since a milestone can be missed
// within budget — a snapshot of the run's last tick (census by role, energy available/capacity/
// storage, buildings built vs wanted) so the history also shows *how far* a stalled run actually got.
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
// the "always passes and keeps a history" benchmark: every run appends a full row to the slow
// suite's own benchmarks-slow.json (see SLOW_BENCH_FILE in ../benchmarks.ts) even when a milestone
// is missed, so the history shows *when* things started going wrong rather than just a single
// pass/fail flip.
//
// Runs in the harness's default room (bunker terrain, spawn on the layout's own spawn tile):
// stubWorld()'s stock rooms cap clearance at 4 vs BUNKER_RADIUS=6, so no anchor would be found.

import { afterAll, beforeAll, expect, test } from "vitest";
import { CONTROLLER_LEVELS } from "@screeps/common/lib/constants";
import { claimsOf, wantedStructures } from "../../../src/colony/building";
import type { RoleName } from "../../../src/memory/schema";
import { operationsFor } from "../../../src/operations";
import {
  ECONOMY_SPEC,
  economyOf,
  formatResult,
  isRegression,
  recordBenchmark,
  reportBenchmark,
  SLOW_BENCH_FILE,
  type BenchmarkSpec
} from "../benchmarks";
import { EnergyMetrics } from "../../integration/energyMetrics";
import { BootedColony, bundleBot } from "../../integration/harness";

// Every role the census can report on, so the final-snapshot spec below has a fixed, known shape
// (unlike buildings, whose types vary by RCL and layout — see finalSnapshotOf).
const ROLES: RoleName[] = [
  "bootstrap",
  "miner",
  "hauler",
  "supply",
  "upgrader",
  "builder",
  "sitter",
  "scout",
  "claimer",
  "pioneer"
];

const TICK_BUDGET = 20_000;

// Overridable so parallel/driver runs (scripts/bench-slow.mjs, bench-parallel.mjs) can shard to
// separate files — recordBenchmark is an unlocked read-modify-write and concurrent runs sharing
// one file would collide. Falls back to the slow suite's own committed history (not the fast
// suite's benchmarks.json) when run directly through vitest, outside a driver script.
const BENCH_OUT = process.env.BENCH_FILE ?? SLOW_BENCH_FILE;

// ECONOMY_SPEC's own "ticks" entry means something different everywhere else it's used (time to
// reach one milestone) — here the run always consumes the whole fixed budget, so that key is
// dropped in favour of the per-rung ticks below, each "first tick this held true" and its own
// regression signal (null if the run never reached it, excluded from future baselines but visible).
const { ticks: _unused, ...ECONOMY_ONLY } = ECONOMY_SPEC;

// Where the run actually stood when the tick budget ran out — a rung the run never reached (RCL5,
// say) tells you it stalled; these tell you *how far* it got instead. All "higher is better" —
// finalBuildingsWanted has no direction since it's a denominator, not an outcome.
// Cumulative controller upgrade points across every level reached: the sum of the progress needed to
// clear each completed level (CONTROLLER_LEVELS[1..level-1]) plus progress into the current one. Unlike
// finalControllerProgress (which resets to ~0 at each level-up), this only ever climbs, so it's a single
// monotonic "total upgrade work done" figure that stays comparable across runs regardless of which RCL
// each one stalled at.
function totalControllerProgress(level: number, progress: number): number {
  const levels = CONTROLLER_LEVELS as Record<number, number>;
  let total = progress;
  for (let l = 1; l < level; l++) total += levels[l] ?? 0;
  return total;
}

const FINAL_SNAPSHOT_SPEC: BenchmarkSpec = {
  finalRcl: { direction: "higher", unit: "level" },
  // Progress into the current level and how much that level needs — together the "current RCL progress".
  finalControllerProgress: { direction: "higher", unit: "progress" },
  finalControllerProgressTotal: { unit: "progress" },
  // Monotonic cumulative upgrade points across all levels; comparable regardless of the RCL reached.
  finalTotalControllerProgress: { direction: "higher", unit: "progress" },
  finalCreepCount: { direction: "higher", unit: "creeps" },
  ...Object.fromEntries(
    ROLES.map(role => [`finalCreeps_${role}`, { direction: "higher", unit: "creeps" } as const])
  ),
  finalEnergyAvailable: { direction: "higher", unit: "energy" },
  finalEnergyCapacity: { direction: "higher", unit: "energy" },
  finalStorageEnergy: { direction: "higher", unit: "energy" },
  finalBuildingsBuilt: { direction: "higher", unit: "structures" },
  finalBuildingsWanted: { unit: "structures" }
};

const MILESTONE_SPEC: BenchmarkSpec = {
  ...ECONOMY_ONLY,
  rcl2: { unit: "ticks" },
  rcl3: { unit: "ticks" },
  rcl4: { unit: "ticks" },
  rcl5: { unit: "ticks" },
  towerBuilt: { unit: "ticks" },
  storageBuilt: { unit: "ticks" },
  ...FINAL_SNAPSHOT_SPEC
};

/** Census, energy and build progress as they stood on the run's last tick — one extra read, not
 * sampled every tick, so it doesn't add per-tick cost to an already-slow 20k-tick loop. */
async function finalSnapshotOf(colony: BootedColony): Promise<Record<string, number | null>> {
  const [ctrl, rolesAlive, energyAvailable, energyCapacity, storageEnergy, layout] = await Promise.all([
    colony.controller(),
    colony.rolesAlive(),
    Promise.all(["spawn", "extension"].map(t => colony.energyIn(t))).then(xs => xs.reduce((a, b) => a + b, 0)),
    colony.energyCapacity(),
    colony.energyIn("storage"),
    colony.layoutSnapshot()
  ]);

  const roleCounts: Record<string, number> = {};
  for (const role of rolesAlive) roleCounts[role] = (roleCounts[role] ?? 0) + 1;

  // Same derivation the rcl-cold-boot benchmarks use: the layout's own wanted set for the room as
  // it actually stands, gated by the RCL it actually reached (not the target the run was aiming for).
  const wanted = layout.anchor ? wantedStructures(layout, claimsOf(layout, operationsFor(layout.name))) : [];
  const builtTypes = new Set(layout.structures.map(s => `${s.type}@${s.x},${s.y}`));
  const built = wanted.filter(w => builtTypes.has(`${w.type}@${w.x},${w.y}`)).length;

  return {
    finalRcl: ctrl.level,
    finalControllerProgress: ctrl.progress,
    finalControllerProgressTotal: ctrl.progressTotal,
    finalTotalControllerProgress: totalControllerProgress(ctrl.level, ctrl.progress),
    finalCreepCount: rolesAlive.length,
    ...Object.fromEntries(ROLES.map(role => [`finalCreeps_${role}`, roleCounts[role] ?? 0])),
    finalEnergyAvailable: energyAvailable,
    finalEnergyCapacity: energyCapacity,
    finalStorageEnergy: storageEnergy,
    finalBuildingsBuilt: built,
    finalBuildingsWanted: wanted.length
  };
}

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
    const finalSnapshot = await finalSnapshotOf(colony);
    const result = recordBenchmark(
      "cold-boot-history",
      { ...milestones, ...economyOf(report), ...finalSnapshot },
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
