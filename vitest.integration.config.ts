import { defineConfig } from "vitest/config";

// Integration harness config (docs/rewrite-skeleton.md §8). Separate from the
// unit suite so `npm test` stays fast and engine-free — these boot a real
// private server via screeps-server-mockup and run on demand only.
//
// Functional/correctness scenarios only — see vitest.benchmark.config.ts for
// the speed-comparison suite. Moving a scenario between the two is just moving
// its file between test/integration and test/benchmark; nothing here pins a
// file to one or the other.
//
// Requires Node 24 + the native mockup build (see the screeps-mockup-install
// memory). `pool: "forks"` gives each file its own process, and `BootedColony.boot`
// self-allocates a free storage port and a unique temp server dir per boot (see
// harness.ts), so files never collide — `fileParallelism` can stay on and vitest
// runs the whole suite concurrently.
//
// `globalSetup` builds the bot bundle exactly once, before any file's worker
// process is spawned, and points every worker at it via BOT_BUNDLE. Without
// this each worker's own bundleBot() call would shell out to rollup
// independently and race on the single shared dist/main.js.
export default defineConfig({
  define: {
    // Matches rollup.config.mjs's PROFILE-gated replace — some fixtures import src/ modules directly
    // alongside the rollup-bundled bot, so this must be defined here too or that import throws.
    __PROFILER_ENABLED__: "false",
    __GIT_COMMIT__: '"test"',
    // Integration/benchmark harnesses boot the real bundled bot against a local pserver — "pserver" here
    // matches that reality and exercises market.ts's gating exactly like a real pserver build would.
    __SERVER__: '"pserver"',
    // Matches rollup.config.mjs's LIQUIDATION_MODE_OVERRIDE-gated replace — some fixtures import
    // empire/boostTargets.ts directly alongside the rollup-bundled bot, same reasoning as
    // __PROFILER_ENABLED__ above. Fixed to the real hand-edited default; the boosting scenarios that need
    // liquidation OFF build their own private bundle instead (see harness.ts's buildBotBundle), since this
    // define only reaches direct src/ imports from the test process, never the bundled bot's own isolate.
    __LIQUIDATION_MODE__: "true"
  },
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    exclude: ["test/integration/watch/**"],
    setupFiles: ["test/constants.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    pool: "forks",
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000
  }
});
