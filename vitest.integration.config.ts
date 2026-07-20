import { defineConfig } from "vitest/config";

// Integration harness config (docs/rewrite-skeleton.md §8). Separate from the
// unit suite so `npm test` stays fast and engine-free — these boot a real
// private server via screeps-server-mockup and run on demand only.
//
// Requires Node 24 + the native mockup build (see the screeps-mockup-install
// memory). `fileParallelism: false` runs scenario files one at a time, each in
// its own isolated fork: the mockup binds a storage port and spawns engine
// child processes plus a driver singleton, so concurrent or shared-process
// files would collide.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    exclude: ["test/integration/watch/**"],
    setupFiles: ["test/constants.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000
  }
});
