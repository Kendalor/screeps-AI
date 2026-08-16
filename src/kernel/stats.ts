// Per-system CPU accounting for the current tick, flushed to Memory.stats.cpu at tick end so the
// metrics panel and any external puller (console, screeps-api) can read last tick's breakdown.

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
  }
};
