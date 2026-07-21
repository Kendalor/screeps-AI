// Run one benchmark file N times concurrently, then merge the results into the
// committed history.
//
//   node scripts/bench-parallel.mjs [runs] [testFile]
//   node scripts/bench-parallel.mjs 4 test/integration/milestones-rcl3.test.ts
//
// Why a driver rather than just launching several vitest processes by hand:
// two things in this suite are not concurrency-safe, and both fail *silently*
// rather than erroring.
//
//   1. The mockup binds a storage port and spawns engine child processes. Two
//      runs on one port collide. Each worker therefore gets its own BENCH_PORT.
//   2. The mockup's server directory defaults to a shared `./server`, into which
//      it copies the seed `db.json`. Concurrent workers overwrite each other's
//      database and die within ~3 seconds. Each worker therefore gets its own
//      BENCH_SERVER_DIR.
//   3. `bundleBot()` shells out to rollup, which writes a single shared
//      `dist/main.js`. Workers building at once truncate the file under each
//      other. This script builds the bundle once up front and hands every
//      worker the path via BOT_BUNDLE.
//   4. `recordBenchmark` is an unlocked read-modify-write of a single JSON file:
//      concurrent runs each load the history, append one entry, and write the
//      whole file back, so the last writer wins and every other run's entry is
//      lost. Each worker therefore writes to its own shard file (BENCH_FILE),
//      and this script merges the shards into the real history sequentially
//      once they have all finished.
//
// Merging appends every run from every shard, then re-applies the same
// MAX_RUNS window the recorder uses, so the committed file keeps its shape.
//
// Note the runs are independent samples of the *same* code — that is the point.
// The recorder compares against the median of prior runs, and a median needs
// several samples before it means anything.

import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

const RUNS = Number(process.argv[2] ?? 4);
const TEST_FILE = process.argv[3] ?? "test/integration/milestones-rcl3.test.ts";
const HISTORY = path.join(REPO, "test", "integration", "benchmarks.json");

// Keep in step with MAX_RUNS in test/integration/benchmarks.ts.
const MAX_RUNS = 10;
// Ports are spaced so a worker's engine children cannot land on the next
// worker's storage port.
const BASE_PORT = 21300;
const PORT_STRIDE = 10;

const load = file => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
};

const shardDir = mkdtempSync(path.join(tmpdir(), "screeps-bench-"));

// Build the bot once, before any worker starts — see note 3 above.
console.log("building bot bundle once for all workers...");
execFileSync(process.execPath, [path.join("node_modules", "rollup", "dist", "bin", "rollup"), "-c"], {
  cwd: REPO,
  stdio: "ignore"
});
const BOT_BUNDLE = path.join(shardDir, "main.js");
copyFileSync(path.join(REPO, "dist", "main.js"), BOT_BUNDLE);

function runWorker(i) {
  const shard = path.join(shardDir, `shard-${i}.json`);
  const env = {
    ...process.env,
    BENCH_PORT: String(BASE_PORT + i * PORT_STRIDE),
    BENCH_FILE: shard,
    BENCH_SERVER_DIR: path.join(shardDir, `server-${i}`),
    BOT_BUNDLE
  };
  const args = [
    path.join("node_modules", "vitest", "vitest.mjs"),
    "run",
    "--config",
    "vitest.integration.config.ts",
    TEST_FILE,
    "--disable-console-intercept"
  ];

  return new Promise(resolve => {
    const started = Date.now();
    execFile(process.execPath, args, { cwd: REPO, env, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const seconds = ((Date.now() - started) / 1000).toFixed(0);
      const runs = load(shard);
      const count = Object.values(runs).reduce((n, list) => n + list.length, 0);
      // A worker that fails its assertions still records whatever it measured,
      // so keep the entries either way — but a worker that recorded *nothing*
      // never produced a data point at all. That is infrastructure failure
      // (port or server-dir collision, a crash on boot), not a benchmark
      // result, and it must be loud: silently merging 2 shards out of 4 looks
      // identical to having asked for 2.
      console.log(
        `  worker ${i}: ${error ? "FAILED" : "ok"} in ${seconds}s, ${count} entr${count === 1 ? "y" : "ies"}`
      );
      if (count === 0) {
        const tail = `${stdout ?? ""}${stderr ?? ""}`.trim().split("\n").slice(-15).join("\n    ");
        console.log(`    !! recorded nothing — last output:\n    ${tail}`);
      }
      resolve({ runs, ok: count > 0 });
    });
  });
}

console.log(`running ${RUNS}x ${TEST_FILE} concurrently (shards in ${shardDir})`);

const results = await Promise.all(Array.from({ length: RUNS }, (_, i) => runWorker(i)));

const merged = load(HISTORY);
let added = 0;
for (const { runs } of results) {
  for (const [benchmark, entries] of Object.entries(runs)) {
    merged[benchmark] = [...(merged[benchmark] ?? []), ...entries].slice(-MAX_RUNS);
    added += entries.length;
  }
}

const ordered = {};
for (const key of Object.keys(merged).sort()) ordered[key] = merged[key];
writeFileSync(HISTORY, JSON.stringify(ordered, null, 2) + "\n", "utf8");
rmSync(shardDir, { recursive: true, force: true });

console.log(`merged ${added} entries into ${path.relative(REPO, HISTORY)}`);
for (const [benchmark, runs] of Object.entries(ordered)) {
  const ticks = runs.map(r => r.ticks).filter(t => typeof t === "number");
  console.log(`  ${benchmark}: ${runs.length} run(s), ticks ${ticks.join(", ")}`);
}

// Exit nonzero if any worker produced no data at all, so a half-empty batch
// cannot pass for a smaller one that was asked for.
const barren = results.filter(r => !r.ok).length;
if (barren > 0) {
  console.error(`\n${barren}/${RUNS} worker(s) recorded nothing — the batch is incomplete.`);
  process.exit(1);
}
