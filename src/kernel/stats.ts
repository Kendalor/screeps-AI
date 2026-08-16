// Per-system CPU accounting for the current tick, flushed to Memory.stats.cpu at tick end so the
// metrics panel and any external puller (console, screeps-api) can read last tick's breakdown.

// Substituted by rollup at build time (rollup.config.mjs) from `git rev-parse --short HEAD`; "test"
// under vitest (see each vitest.*.config.ts's define block). Not gated behind __PROFILER_ENABLED__ —
// unlike the profiler, this is meant to be always-on so every deployed tick's stats can be traced back
// to the commit that produced them (this project doesn't tag releases/versions).
declare const __GIT_COMMIT__: string;

let cpuBySystem: Record<string, number> = {};

export const stats = {
  record(system: string, cpu: number): void {
    cpuBySystem[system] = (cpuBySystem[system] ?? 0) + cpu;
  },
  read(): Readonly<Record<string, number>> {
    return cpuBySystem;
  },
  reset(): void {
    cpuBySystem = {};
  },
  /** Flush the tick's per-system CPU (and bucket gauge) into Memory.stats. Called once, after every
   * system has run. No-ops when Memory.stats isn't set up yet — tick() is called directly in some unit
   * tests, without migrateMemory() having run first. */
  flush(bucket: number): void {
    if (!Memory.stats) return;
    Memory.stats.cpu = cpuBySystem;
    Memory.stats.bucket = bucket;
    Memory.stats.commit = __GIT_COMMIT__;
  }
};
