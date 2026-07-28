// Shared plumbing for scripts/bench.mjs and scripts/bench-parallel.mjs: both
// run several vitest processes against test/benchmark/ concurrently and must
// avoid the same two silent races (see either script's header for why):
//
//   1. bundleBot() shells out to rollup and writes the single shared
//      dist/main.js — built once here, handed to every worker via BOT_BUNDLE.
//   2. recordBenchmark is an unlocked read-modify-write of the committed
//      benchmarks.json — each worker writes to its own shard file instead,
//      merged into the real history once every worker has finished.

import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.join(HERE, "..");
export const HISTORY = path.join(REPO, "test", "benchmark", "benchmarks.json");
// The slow (test/benchmark/slow/) benchmarks keep their own history file — a 20k-tick cold boot
// isn't comparable to the fast milestones and shouldn't crowd the same committed file.
export const HISTORY_SLOW = path.join(REPO, "test", "benchmark", "slow", "benchmarks-slow.json");

// Keep in step with MAX_RUNS in test/benchmark/benchmarks.ts. This is the cap mergeIntoHistory
// applies to the committed file; when it was smaller than the recorder's cap the history was pinned
// to a permanent N-wide sliding window that dropped the oldest run on every bench:slow invocation, so
// the median baseline never accumulated and lurched across a mix of commits instead of stabilising.
export const MAX_RUNS = 100;

export const load = file => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
};

/** Build the bot bundle once and return its path, for every worker's BOT_BUNDLE. */
export function buildBundleOnce(shardDir) {
  console.log("building bot bundle once for all workers...");
  execFileSync(process.execPath, [path.join("node_modules", "rollup", "dist", "bin", "rollup"), "-c"], {
    cwd: REPO,
    stdio: "ignore"
  });
  const bundlePath = path.join(shardDir, "main.js");
  copyFileSync(path.join(REPO, "dist", "main.js"), bundlePath);
  return bundlePath;
}

/**
 * Run one vitest worker against `testFile` (or the whole benchmark suite when
 * omitted), recording into its own shard so concurrent workers never collide
 * on the committed history file.
 */
export function runWorker({ id, testFile, shard, botBundle, history = HISTORY }) {
  // Seed the shard with the committed history so recordBenchmark's baseline
  // lookup — which only ever reads BENCH_FILE — sees real prior runs instead
  // of reporting "no baseline yet" on every single run. The seeded counts are
  // remembered so mergeIntoHistory can tell seed from new entry afterwards.
  const seed = load(history);
  writeFileSync(shard, JSON.stringify(seed), "utf8");
  const seedCounts = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.length]));

  const env = { ...process.env, BENCH_FILE: shard, BOT_BUNDLE: botBundle };
  const args = [
    path.join("node_modules", "vitest", "vitest.mjs"),
    "run",
    "--config",
    "vitest.benchmark.config.ts",
    ...(testFile ? [testFile] : []),
    "--disable-console-intercept"
  ];

  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd: REPO, env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const seconds = ((Date.now() - started) / 1000).toFixed(0);
      const all = load(shard);
      // Only the tail past the seed is this worker's own new data — the rest
      // is the committed history it was seeded with, already on disk.
      const runs = Object.fromEntries(
        Object.entries(all).map(([benchmark, entries]) => [benchmark, entries.slice(seedCounts[benchmark] ?? 0)])
      );
      const count = Object.values(runs).reduce((n, list) => n + list.length, 0);
      // A worker that fails its assertions still records whatever it measured,
      // so keep the entries either way — but a worker that recorded *nothing*
      // never produced a data point at all. That is infrastructure failure (a
      // crash on boot, a bad path), not a benchmark result, and it must be
      // loud: silently merging a partial batch looks identical to a smaller
      // one that was asked for on purpose.
      console.log(`  ${id}: ${error ? "FAILED" : "ok"} in ${seconds}s, ${count} entr${count === 1 ? "y" : "ies"}`);
      // Each worker's own console output (formatResult()'s per-measurement
      // comparisons, most importantly) only exists in this captured buffer —
      // execFile never lets it reach the real terminal on its own — so it must
      // be printed here or the run's actual evaluation is silently lost.
      const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
      if (output) console.log(`    ${output.split("\n").join("\n    ")}`);
      if (count === 0) console.log(`    !! recorded nothing`);
      resolve({ runs, ok: count > 0 });
    });
  });
}

/** Merge every worker's shard into the committed history, applying MAX_RUNS. */
export function mergeIntoHistory(results, history = HISTORY) {
  const merged = load(history);
  let added = 0;
  for (const { runs } of results) {
    for (const [benchmark, entries] of Object.entries(runs)) {
      merged[benchmark] = [...(merged[benchmark] ?? []), ...entries].slice(-MAX_RUNS);
      added += entries.length;
    }
  }

  const ordered = {};
  for (const key of Object.keys(merged).sort()) ordered[key] = merged[key];
  writeFileSync(history, JSON.stringify(ordered, null, 2) + "\n", "utf8");

  console.log(`merged ${added} entries into ${path.relative(REPO, history)}`);
  for (const [benchmark, runs] of Object.entries(ordered)) {
    const ticks = runs.map(r => r.ticks).filter(t => typeof t === "number");
    console.log(`  ${benchmark}: ${runs.length} run(s), ticks ${ticks.join(", ")}`);
  }
  return ordered;
}

export function makeShardDir() {
  return mkdtempSync(path.join(tmpdir(), "screeps-bench-"));
}

export function cleanupShardDir(shardDir) {
  rmSync(shardDir, { recursive: true, force: true });
}
