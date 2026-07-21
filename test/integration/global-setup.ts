// vitest globalSetup: builds the bot bundle once before parallel test-file workers spawn, avoiding
// a race where each process's rollup call wipes and rewrites the shared dist/main.js concurrently.
// Skipped when BOT_BUNDLE is already set — scripts/bench-parallel.mjs builds its own bundle first.
import { execFileSync } from "node:child_process";
import path from "node:path";

export default function setup(): void {
  if (process.env.BOT_BUNDLE) return;
  const repoRoot = process.cwd();
  const rollupBin = path.join(repoRoot, "node_modules", "rollup", "dist", "bin", "rollup");
  execFileSync(process.execPath, [rollupBin, "-c"], { cwd: repoRoot, stdio: "inherit" });
  process.env.BOT_BUNDLE = path.join(repoRoot, "dist", "main.js");
}
