// Run the SLOW cold-boot benchmarks in test/benchmark/slow/ once each, then merge the results
// into the committed history. This is what `npm run bench:slow` calls.
//
// These are kept out of `npm run bench` (scripts/bench.mjs) on purpose: a full RCL0->2->3 cold
// boot is ~10x the seeded RCL2->3 leg, far too slow for the standard set. scripts/bench.mjs reads
// test/benchmark/ non-recursively, so files in this subdirectory are already excluded there; this
// script is how you run them deliberately. They still write into the same benchmarks.json history
// and get the same median-baseline statistics as every other milestone (see bench-shared.mjs).
//
// For building up several samples of one slow target faster, use scripts/bench-parallel.mjs with
// the explicit test file, e.g.
//   node scripts/bench-parallel.mjs 4 test/benchmark/slow/milestones-rcl3-cold-boot.test.ts
//
// See scripts/bench-shared.mjs for why a driver is needed at all: the bundle build and the
// committed history file are both unsafe to touch from more than one process at once, and both
// fail silently rather than erroring.
//
// The slow benchmarks record into their own history file (test/benchmark/slow/benchmarks-slow.json)
// rather than the fast suite's benchmarks.json — a 20k-tick cold boot isn't a comparable run to the
// fast milestones and shouldn't crowd the same committed history.

import { readdirSync } from "node:fs";
import path from "node:path";
import {
  buildBundleOnce,
  cleanupShardDir,
  HISTORY_SLOW,
  makeShardDir,
  mergeIntoHistory,
  REPO,
  runWorker
} from "./bench-shared.mjs";

const SLOW_DIR = path.join(REPO, "test", "benchmark", "slow");
const files = readdirSync(SLOW_DIR)
  .filter(f => f.endsWith(".test.ts"))
  .map(f => path.join("test", "benchmark", "slow", f));

if (files.length === 0) {
  console.error("no benchmark files found in test/benchmark/slow/");
  process.exit(1);
}

const shardDir = makeShardDir();
const botBundle = buildBundleOnce(shardDir);

console.log(`running ${files.length} slow benchmark file(s) concurrently (shards in ${shardDir})`);
for (const f of files) console.log(`  - ${f}`);

const results = await Promise.all(
  files.map((testFile, i) =>
    runWorker({
      id: testFile,
      testFile,
      shard: path.join(shardDir, `shard-${i}.json`),
      botBundle,
      history: HISTORY_SLOW
    })
  )
);

mergeIntoHistory(results, HISTORY_SLOW);
cleanupShardDir(shardDir);

const barren = results.filter(r => !r.ok).length;
if (barren > 0) {
  console.error(`\n${barren}/${files.length} slow benchmark file(s) recorded nothing — the run is incomplete.`);
  process.exit(1);
}
