import { defineConfig } from "vitest/config";

// Same runtime setup as vitest.integration.config.ts, but scoped to
// test/integration/watch/ — scripts there stream a live tick-by-tick view of
// a run to the terminal and are excluded from vitest.integration.config.ts,
// so `npm run test:integration` never runs them. Use `npm run watch:integration`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/watch/**/*.test.ts"],
    setupFiles: ["test/constants.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000,
    silent: false
  }
});
