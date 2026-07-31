import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // Matches rollup.config.mjs's PROFILE-gated replace; always off under test so profiling never adds
    // overhead to the suite and profileModule()/profileFunctions() calls at import time are no-ops.
    __PROFILER_ENABLED__: "false"
  },
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
    setupFiles: ["test/constants.ts"]
  }
});
