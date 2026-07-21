// Benchmark history for integration milestones.
//
// The milestone scenarios already know what a run cost; what they could not do
// was tell whether 640 ticks is better or worse than last week. This records
// each run into a committed JSON file (`benchmarks.json`, next to this module)
// keeping the last MAX_RUNS runs per benchmark, so a diff of that file *is* the
// performance history.
//
// Shape: benchmark -> runs -> the measurements taken during that run.
//
//   { "rcl2": [ { at, commit, ticks: 510, energyHarvestedPerTick: 6.04, ... } ] }
//
// One run of a scenario yields ONE entry carrying every measurement it took, so
// figures that were observed together stay together — a slow run and the
// harvest rate that explains it sit on the same line, and reading the history
// tells a story rather than forcing a join across parallel metric lists.
//
// Design notes:
//   - The file is committed on purpose. A benchmark nobody can diff is a log
//     line; one in git is a record that survives machines and CI.
//   - The baseline for each measurement is the median of the *previous* runs,
//     not the last one: single runs of a live server carry real pathing
//     variance, and a median resists one lucky/unlucky run.
//   - Measurements are compared independently but recorded as a unit, so adding
//     a new measurement never invalidates the history of the existing ones —
//     older runs simply lack the key and are skipped for that baseline.
//   - Set BENCH_NO_WRITE=1 to measure and compare without touching the file
//     (useful on a branch you don't want history noise from).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BENCH_FILE = path.join(HERE, "benchmarks.json");

/** How many runs of history to keep per benchmark. Older runs are dropped. */
export const MAX_RUNS = 10;

/**
 * Which way is better for a measurement. Ticks-to-milestone are "lower" (faster
 * is better); energy rates are "higher" (more harvest per tick is better).
 * Without this a rising harvest rate would be flagged as a regression.
 */
export type Direction = "lower" | "higher";

/** How a single measurement is interpreted. Not stored — it lives in the test. */
export interface MeasurementSpec {
  /** Which way is better. Default "lower". */
  direction?: Direction;
  /** Unit shown in the report, e.g. "ticks", "energy/tick". Default "ticks". */
  unit?: string;
  /**
   * Fraction of the baseline a run may drift in the *worse* direction before it
   * counts as a regression. Default 0.25 — see isRegression.
   */
  tolerance?: number;
}

/** The specs for every measurement a benchmark takes, keyed by measurement name. */
export type BenchmarkSpec = Record<string, MeasurementSpec>;

/**
 * One recorded run: bookkeeping fields plus every measurement taken, keyed by
 * name. A measurement is null when it could not be taken (milestone never
 * reached, nothing harvested), which excludes it from future baselines.
 */
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
    // Missing or unparseable history is not an error: the first run on a fresh
    // clone has nothing to compare against and simply starts the record.
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
  /**
   * How far the run moved in the *worse* direction, as a fraction of baseline.
   * Negative means it improved. This is what the tolerance is checked against,
   * and it is what makes "higher is better" measurements work.
   */
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

/**
 * Fold one run's `measurements` into the history for `benchmark` and return how
 * each compares to the runs that came before it. Comparisons are computed
 * against history as it stood *before* this run, so a run never flatters itself.
 */
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

  // Only runs that actually recorded this measurement form its baseline, so a
  // measurement added later starts its own history without being dragged by
  // older runs that predate it.
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

/**
 * True when a measurement is materially worse than its baseline, in whichever
 * direction "worse" means for it. The tolerance (default 0.25) is the fraction
 * of the baseline it may drift by before it counts — the mockup plus real
 * pathing makes exact figures non-deterministic, so a hard equality check would
 * flap. Measurements with no history never regress; an unmeasured one always does.
 */
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
  // Label by the same tolerance the pass/fail uses, so the words match the
  // verdict: a +3% wobble on a live server is noise, and calling it a
  // "regression" in a passing run trains you to ignore the word. Direction is
  // respected, so more energy/tick reads as an improvement, not a regression.
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
