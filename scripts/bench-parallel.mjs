// Run one benchmark target N times concurrently, then merge the results into
// the committed history. For running the whole suite once each (the common
// case), use `npm run bench` (scripts/bench.mjs) instead — this script is for
// building up several *samples of the same target*, which a median baseline
// needs before it means anything.
//
//   node scripts/bench-parallel.mjs [runs] [testFile]
//   node scripts/bench-parallel.mjs 4 test/benchmark/milestones-rcl3-from-seed.test.ts
//   node scripts/bench-parallel.mjs 4                      # whole suite, 4x
//
// See scripts/bench-shared.mjs for why a driver is needed at all: the bundle
// build and the committed history file are both unsafe to touch from more than
// one process at once, and both fail silently rather than erroring.
//
// Note the runs are independent samples of the *same* code — that is the
// point. The recorder compares against the median of prior runs, and a median
// needs several samples before it means anything.

import path from "node:path";
import { buildBundleOnce, cleanupShardDir, HISTORY_SLOW, makeShardDir, mergeIntoHistory, runWorker } from "./bench-shared.mjs";

const RUNS = Number(process.argv[2] ?? 4);
const TEST_FILE = process.argv[3];

// A target under test/benchmark/slow/ records into its own history file (see bench-slow.mjs) —
// keep that true here too, or a parallel batch of a slow target would pollute the fast history.
const history = TEST_FILE?.split(path.sep).includes("slow") ? HISTORY_SLOW : undefined;

const shardDir = makeShardDir();
const botBundle = buildBundleOnce(shardDir);

console.log(`running ${RUNS}x ${TEST_FILE ?? "test/benchmark/**"} concurrently (shards in ${shardDir})`);

const results = await Promise.all(
  Array.from({ length: RUNS }, (_, i) =>
    runWorker({
      id: `worker ${i}`,
      testFile: TEST_FILE,
      shard: `${shardDir}/shard-${i}.json`,
      botBundle,
      history
    })
  )
);

mergeIntoHistory(results, history);
cleanupShardDir(shardDir);

// Exit nonzero if any worker produced no data at all, so a half-empty batch
// cannot pass for a smaller one that was asked for.
const barren = results.filter(r => !r.ok).length;
if (barren > 0) {
  console.error(`\n${barren}/${RUNS} worker(s) recorded nothing — the batch is incomplete.`);
  process.exit(1);
}
