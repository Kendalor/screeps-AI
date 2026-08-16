import { defineConfig } from "vitest/config";

// Benchmark config (docs/rewrite-skeleton.md §8). Same runtime setup as
// vitest.integration.config.ts, but scoped to test/benchmark/ — scenarios here
// don't assert correctness, they record a run's cost into the committed
// benchmarks.json history and fail on a material regression against it. Moving
// a scenario between "integration" and "benchmark" is just moving its file
// between the two directories; nothing pins a file to one or the other.
//
// Requires Node 24 + the native mockup build (see the screeps-mockup-install
// memory). `pool: "forks"` gives each file its own process, and `BootedColony.boot`
// self-allocates a free storage port and a unique temp server dir per boot (see
// harness.ts), so files never collide — `fileParallelism` can stay on and
// `npm run bench` runs every benchmark concurrently.
//
// `globalSetup` builds the bot bundle exactly once, before any file's worker
// process is spawned, and points every worker at it via BOT_BUNDLE (unless
// BOT_BUNDLE is already set — scripts/bench-parallel.mjs sets it itself when
// running several benchmark processes at once, and that build must win).
export default defineConfig({
  define: {
    __PROFILER_ENABLED__: "false",
    __GIT_COMMIT__: '"test"'
  },
  test: {
    environment: "node",
    include: ["test/benchmark/**/*.test.ts"],
    setupFiles: ["test/constants.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    pool: "forks",
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000
  }
});
