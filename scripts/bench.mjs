// Run every test/benchmark/*.test.ts file once, concurrently, then merge the
// results into the committed history. This is what `npm run bench` calls.
//
// For running one target several times to build up a median baseline faster,
// use scripts/bench-parallel.mjs instead.
//
// See scripts/bench-shared.mjs for why a driver is needed at all: the bundle
// build and the committed history file are both unsafe to touch from more than
// one process at once, and both fail silently rather than erroring. Running
// vitest directly on the whole test/benchmark/ directory would hit exactly
// that: several files finishing their `recordBenchmark` write around the same
// moment, with the last writer silently dropping every other file's entry.
// One worker per file, each into its own shard, avoids it regardless of
// timing or how many benchmark files exist.

import { readdirSync } from "node:fs";
import path from "node:path";
import { buildBundleOnce, cleanupShardDir, makeShardDir, mergeIntoHistory, REPO, runWorker } from "./bench-shared.mjs";

const BENCH_DIR = path.join(REPO, "test", "benchmark");
const files = readdirSync(BENCH_DIR)
  .filter(f => f.endsWith(".test.ts"))
  .map(f => path.join("test", "benchmark", f));

if (files.length === 0) {
  console.error("no benchmark files found in test/benchmark/");
  process.exit(1);
}

const shardDir = makeShardDir();
const botBundle = buildBundleOnce(shardDir);

console.log(`running ${files.length} benchmark file(s) concurrently (shards in ${shardDir})`);
for (const f of files) console.log(`  - ${f}`);

const results = await Promise.all(
  files.map((testFile, i) =>
    runWorker({
      id: testFile,
      testFile,
      shard: path.join(shardDir, `shard-${i}.json`),
      botBundle
    })
  )
);

mergeIntoHistory(results);
cleanupShardDir(shardDir);

const barren = results.filter(r => !r.ok).length;
if (barren > 0) {
  console.error(`\n${barren}/${files.length} benchmark file(s) recorded nothing — the run is incomplete.`);
  process.exit(1);
}
