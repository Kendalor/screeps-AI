import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // Matches rollup.config.mjs's PROFILE-gated replace; always off under test so profiling never adds
    // overhead to the suite and profileModule()/profileFunctions() calls at import time are no-ops.
    __PROFILER_ENABLED__: "false",
    // Matches rollup.config.mjs's git-derived replace; a fixed placeholder under test so stats output
    // doesn't depend on the sandbox's git state.
    __GIT_COMMIT__: '"test"'
  },
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
    setupFiles: ["test/constants.ts"]
  }
});
