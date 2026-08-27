import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // Matches rollup.config.mjs's PROFILE-gated replace; always off under test so profiling never adds
    // overhead to the suite and profileModule()/profileFunctions() calls at import time are no-ops.
    __PROFILER_ENABLED__: "false",
    // Matches rollup.config.mjs's git-derived replace; a fixed placeholder under test so stats output
    // doesn't depend on the sandbox's git state.
    __GIT_COMMIT__: '"test"',
    // Fixed to "main" under test so the market-trading modules (empire/marketOrders.ts,
    // empire/marketFallback.ts) it gates are always importable/unit-testable — the gating itself is a
    // build-time rollup substitution, explicitly out of unit-test scope (see docs/market-plan.md).
    __SERVER__: '"main"',
    // Matches rollup.config.mjs's LIQUIDATION_MODE_OVERRIDE-gated replace; fixed to the real hand-edited
    // default under test — tests needing the opposite use setLiquidationModeOverrideForTest's in-process
    // runtime override instead (boostTargets.ts), since the build-time substitution only matters for the
    // bundled integration-test bot, never for unit tests importing the module directly.
    __LIQUIDATION_MODE__: "true"
  },
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
    setupFiles: ["test/constants.ts"]
  }
});
