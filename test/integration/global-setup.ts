// vitest globalSetup: runs once in the main process before any test file's
// worker is spawned — the one safe place to build the bot bundle when
// `fileParallelism` is on.
//
// bundleBot() (harness.ts) shells out to rollup and writes the single shared
// `dist/main.js`. With files running in parallel forks, every file would call
// it in its own process and race on that one path (rollup's `clear` plugin
// wipes `dist/` first, so two builds at once corrupt each other). Building
// once here and pointing every worker at the result via BOT_BUNDLE — the same
// env var scripts/bench-parallel.mjs already uses for the same reason — avoids
// the race entirely instead of serializing around it.
//
// Skipped when BOT_BUNDLE is already set: scripts/bench-parallel.mjs builds
// its own bundle up front (so N concurrent `vitest run` processes share one
// build) and sets BOT_BUNDLE before invoking vitest — that build must win,
// not get clobbered by a second one here.
import { execFileSync } from "node:child_process";
import path from "node:path";

export default function setup(): void {
  if (process.env.BOT_BUNDLE) return;
  const repoRoot = process.cwd();
  const rollupBin = path.join(repoRoot, "node_modules", "rollup", "dist", "bin", "rollup");
  execFileSync(process.execPath, [rollupBin, "-c"], { cwd: repoRoot, stdio: "inherit" });
  process.env.BOT_BUNDLE = path.join(repoRoot, "dist", "main.js");
}
