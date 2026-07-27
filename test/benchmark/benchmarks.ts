// Records each benchmark run to a committed JSON file (benchmarks.json) so runs are comparable over time.
//
// Shape: benchmark -> runs -> the measurements taken during that run, e.g.
//   { "rcl2": [ { at, commit, ticks: 510, energyHarvestedPerTick: 6.04, ... } ] }
// One run yields ONE entry carrying every measurement, so figures observed together stay together.
//
// Baseline is the median of *previous* runs (resists one lucky/unlucky run on a live server).
// Set BENCH_NO_WRITE=1 to measure and compare without touching the file.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { EnergyReport } from "../integration/energyMetrics";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BENCH_FILE = path.join(HERE, "benchmarks.json");
// test/benchmark/slow/*.test.ts default to this instead — a 20k-tick cold boot isn't comparable to
// the fast milestones and shouldn't crowd the same committed history. scripts/bench-slow.mjs and
// bench-parallel.mjs already route explicitly to the same file via BENCH_FILE; this is the fallback
// for running a slow test file directly through vitest, without going through a driver script.
export const SLOW_BENCH_FILE = path.join(HERE, "slow", "benchmarks-slow.json");

/** How many runs of history to keep per benchmark. Older runs are dropped. */
export const MAX_RUNS = 100;

/** Which way is better for a measurement — "lower" for ticks, "higher" for energy rates. */
export type Direction = "lower" | "higher";

/** How a single measurement is interpreted. Not stored — it lives in the test. */
export interface MeasurementSpec {
  /** Which way is better. Default "lower". */
  direction?: Direction;
  /** Unit shown in the report, e.g. "ticks", "energy/tick". Default "ticks". */
  unit?: string;
  /** Fraction of baseline a run may drift worse before it counts as a regression. Default 0.25. */
  tolerance?: number;
}

/** The specs for every measurement a benchmark takes, keyed by measurement name. */
export type BenchmarkSpec = Record<string, MeasurementSpec>;

/** A measurement is null when it could not be taken, which excludes it from future baselines. */
export interface BenchRun {
  /** ISO timestamp of the run. */
  at: string;
  /** Short label for the code under test — the git HEAD short sha when available. */
  commit?: string;
  [measurement: string]: number | null | string | undefined;
}

/** benchmark name -> runs, oldest first. */
export type BenchFile = Record<string, BenchRun[]>;

/** Keys on a run that are bookkeeping rather than measurements. */
const META_KEYS = new Set(["at", "commit"]);

/** The measurement value from a run, or null when absent/not a number. */
export function measurementOf(run: BenchRun, name: string): number | null {
  const v = run[name];
  return typeof v === "number" ? v : null;
}

/** Measurement names present across a benchmark's runs, in first-seen order. */
export function measurementNames(runs: BenchRun[]): string[] {
  const seen: string[] = [];
  for (const r of runs) {
    for (const k of Object.keys(r)) {
      if (!META_KEYS.has(k) && !seen.includes(k)) seen.push(k);
    }
  }
  return seen;
}

export function loadBenchmarks(file = BENCH_FILE): BenchFile {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as BenchFile;
  } catch {
    // A fresh clone has no history file yet; that's not an error, just an empty record.
    return {};
  }
}

function saveBenchmarks(data: BenchFile, file = BENCH_FILE): void {
  const ordered: BenchFile = {};
  for (const k of Object.keys(data).sort()) ordered[k] = data[k];
  writeFileSync(file, JSON.stringify(ordered, null, 2) + "\n", "utf8");
}

/** Median of a numeric list (mean of the middle pair when even). */
export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** How one measurement of this run compares to the same measurement before it. */
export interface Comparison {
  measurement: string;
  value: number | null;
  direction: Direction;
  unit: string;
  tolerance: number;
  /** Median of prior runs that recorded this measurement, or null if none did. */
  baseline: number | null;
  /** value - baseline. null without a baseline. */
  delta: number | null;
  /** delta as a fraction of baseline. null without a baseline. */
  ratio: number | null;
  /** How far the run moved in the *worse* direction, as a fraction of baseline (negative = improved). */
  regressionRatio: number | null;
  /** How many prior runs contributed to the baseline. */
  samples: number;
}

/** The result of recording one run: the run itself plus a comparison per measurement. */
export interface BenchResult {
  benchmark: string;
  comparisons: Comparison[];
  /** Prior runs, oldest first — the history this run was judged against. */
  history: BenchRun[];
  /** Look up one measurement's comparison by name. */
  get(measurement: string): Comparison | undefined;
}

// Comparisons are computed against history as it stood *before* this run, so a run never flatters itself.
export function recordBenchmark(
  benchmark: string,
  measurements: Record<string, number | null>,
  specs: BenchmarkSpec = {},
  file = BENCH_FILE
): BenchResult {
  const data = loadBenchmarks(file);
  const history = data[benchmark] ?? [];

  const comparisons = Object.entries(measurements).map(([name, value]) =>
    compareMeasurement(name, value, history, specs[name] ?? {})
  );

  const run: BenchRun = { at: new Date().toISOString(), commit: shortSha(), ...measurements };
  if (process.env.BENCH_NO_WRITE !== "1") {
    data[benchmark] = [...history, run].slice(-MAX_RUNS);
    saveBenchmarks(data, file);
  }

  return {
    benchmark,
    comparisons,
    history,
    get: name => comparisons.find(c => c.measurement === name)
  };
}

function compareMeasurement(
  name: string,
  value: number | null,
  history: BenchRun[],
  spec: MeasurementSpec
): Comparison {
  const direction = spec.direction ?? "lower";
  const unit = spec.unit ?? "ticks";
  const tolerance = spec.tolerance ?? 0.25;

  // A measurement added later starts its own history rather than being dragged by older runs lacking it.
  const prior = history.map(r => measurementOf(r, name)).filter((v): v is number => v !== null);
  const baseline = prior.length ? median(prior) : null;

  const delta = value !== null && baseline !== null ? value - baseline : null;
  const ratio = delta !== null && baseline ? delta / baseline : null;
  // For "higher is better", moving down is the regression — flip the sign.
  const regressionRatio = ratio === null ? null : direction === "lower" ? ratio : -ratio;

  return {
    measurement: name,
    value,
    direction,
    unit,
    tolerance,
    baseline,
    delta,
    ratio,
    regressionRatio,
    samples: prior.length
  };
}

// Tolerance-based rather than exact equality: real pathing makes exact figures non-deterministic.
// Measurements with no history never regress; an unmeasured one always does.
export function isRegression(c: Comparison, tolerance = c.tolerance): boolean {
  if (c.value === null) return true;
  if (c.regressionRatio === null) return false;
  return c.regressionRatio > tolerance;
}

/** Every measurement of this run that counts as a regression. */
export function regressions(result: BenchResult): Comparison[] {
  return result.comparisons.filter(c => isRegression(c));
}

/** Round for display without pretending to precision the mockup doesn't have. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** One line per measurement: value, baseline, and the verdict. */
export function formatComparison(c: Comparison): string {
  const shown = c.value === null ? "NOT MEASURED" : `${fmt(c.value)} ${c.unit}`;
  if (c.baseline === null) return `${c.measurement}: ${shown} (no baseline yet)`;

  const pct = c.ratio === null ? "" : ` ${c.ratio >= 0 ? "+" : ""}${(c.ratio * 100).toFixed(1)}%`;
  // Same tolerance as the pass/fail check, so the label always agrees with the verdict.
  const verdict =
    c.regressionRatio === null
      ? ""
      : isRegression(c)
        ? " REGRESSION"
        : c.regressionRatio < 0
          ? " improvement"
          : " within noise";
  return `${c.measurement}: ${shown} vs baseline ${fmt(c.baseline)} (n=${c.samples}, ${c.direction} better)${pct}${verdict}`;
}

/** Full human-readable block for a run — the assertion message and run log. */
export function formatResult(result: BenchResult): string {
  const lines = [`benchmark ${result.benchmark}:`];
  for (const c of result.comparisons) lines.push(`  ${formatComparison(c)}`);

  const recent = result.history.slice(-MAX_RUNS);
  if (recent.length) {
    const names = measurementNames(recent);
    lines.push(`  history (oldest first, ${recent.length} run(s)):`);
    for (const r of recent) {
      const cells = names
        .map(n => {
          const v = measurementOf(r, n);
          return `${n}=${v === null ? "-" : fmt(v)}`;
        })
        .join(" ");
      lines.push(`    ${r.at} ${r.commit ?? "-"} ${cells}`);
    }
  }
  return lines.join("\n");
}

// Shared by every milestone benchmark (rcl2, rcl3, ...) so they all measure and print identically —
// only their checkpoint ladders and run conditions differ.
export const ECONOMY_SPEC: BenchmarkSpec = {
  ticks: { unit: "ticks" },
  energyHarvestedPerTick: { direction: "higher", unit: "energy/tick" },
  energyWasteFraction: { unit: "fraction of available income" },
  energyDecayed: { unit: "energy" },
  wastedDecayedPercentage: { unit: "% of total harvested" },
  sinkUpgrading: { direction: "higher", unit: "fraction of spend" },
  sinkConstruction: { unit: "fraction of spend" },
  sinkCreeps: { unit: "fraction of spend" }
};

// energyWasteFraction is a fraction, not a per-tick rate, because waste accrues in lumps at source
// regen rather than as a flow. sink{Upgrading,Construction,Creeps} are fractions of spend so a
// longer run doesn't inflate them.
/** Turn an energy report into this run's economy measurements. */
export function economyOf(report: EnergyReport): Record<string, number | null> {
  const available = report.harvested + report.wasted;
  const { upgrading, construction, creeps } = report.sinks;
  const spent = upgrading + construction + creeps;
  return {
    energyHarvestedPerTick: report.perTick.harvested,
    energyWasteFraction: available ? report.wasted / available : null,
    energyDecayed: report.decayed,
    // Decay expressed against what was actually harvested, so the absolute figure has a reference.
    wastedDecayedPercentage: report.harvested ? (report.decayed / report.harvested) * 100 : null,
    sinkUpgrading: spent ? upgrading / spent : null,
    sinkConstruction: spent ? construction / spent : null,
    sinkCreeps: spent ? creeps / spent : null
  };
}

/** Print the run in full (the numbers are the point). No assertions — see assertNoRegression. */
export function reportBenchmark(result: BenchResult): void {
  console.log(formatResult(result));
}

/** Fail if any measurement regressed against baseline. Kept separate from reportBenchmark so a test
 * can record + print a run (which recordBenchmark already persisted to disk), run its own milestone
 * assertions with clearer messages first, and only then assert on regressions last. */
export function assertNoRegression(result: BenchResult): void {
  const bad = regressions(result);
  expect(bad.map(c => c.measurement), formatResult(result)).toEqual([]);
}

/** Print the run in full (the numbers are the point) and fail on any regression. */
export function checkBenchmark(result: BenchResult): void {
  reportBenchmark(result);
  assertNoRegression(result);
}

function shortSha(): string | undefined {
  try {
    // Cheap and dependency-free; a detached/absent git dir just yields undefined.
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: path.join(HERE, "..", ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}
