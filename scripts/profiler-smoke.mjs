// One-off smoke test for the PROFILE=1 build: boots a real mockup server with the profiling bundle,
// runs a batch of ticks, starts the profiler via console, runs more ticks, and checks for any error
// console lines. Throwaway verification script — delete after use, not part of the normal toolchain.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ScreepsServer } from "screeps-server-mockup";

const REPO_ROOT = process.cwd();

console.log("Building PROFILE=1 bundle...");
execFileSync(process.execPath, [path.join(REPO_ROOT, "node_modules", "rollup", "dist", "bin", "rollup"), "-c"], {
  cwd: REPO_ROOT,
  env: { ...process.env, PROFILE: "1" },
  stdio: "inherit"
});
const botCode = readFileSync(path.join(REPO_ROOT, "dist", "main.js"), "utf8");
console.log(`Bundle size: ${botCode.length} bytes`);

const serverDir = mkdtempSync(path.join(tmpdir(), "screeps-profiler-smoke-"));
const server = new ScreepsServer({ path: serverDir, logdir: path.join(serverDir, "logs") });

const errors = [];
const allLines = [];

try {
  await server.world.stubWorld();
  const terrain = await server.world.getTerrain("W0N1");
  await server.world.setTerrain("W0N1", terrain);
  const bot = await server.world.addBot({ username: "smoketest", room: "W0N1", x: 20, y: 30, modules: { main: botCode } });
  await server.start();

  bot.on("console", (log, _results, _userid, username) => {
    for (const line of log) {
      allLines.push(line);
      if (/error/i.test(line)) errors.push(line);
    }
  });

  console.log("Running 20 ticks (profiler not started)...");
  for (let i = 0; i < 20; i++) await server.tick();

  console.log("Starting profiler via console command...");
  await bot.console("Profiler.start()");
  await server.tick();

  console.log("Running 30 more ticks with profiler active...");
  for (let i = 0; i < 30; i++) await server.tick();

  console.log("Calling Profiler.output()...");
  await bot.console("Profiler.output()");
  await server.tick();
  await server.tick();

  console.log(`\nTotal console lines captured: ${allLines.length}`);
  console.log(`Error-matching lines: ${errors.length}`);
  if (errors.length > 0) {
    console.log("\n=== ERRORS ===");
    for (const e of errors) console.log(e);
  }
  console.log("\n=== LAST 40 CONSOLE LINES ===");
  for (const line of allLines.slice(-40)) console.log(line);
} finally {
  server.stop();
  rmSync(serverDir, { recursive: true, force: true });
}

if (errors.length > 0) {
  console.error(`\nFAIL: ${errors.length} error line(s) seen`);
  process.exit(1);
} else {
  console.log("\nPASS: no error lines seen");
}
