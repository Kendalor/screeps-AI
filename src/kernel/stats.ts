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
  /** Flush the tick's per-system CPU into Memory.stats.cpu. Called once, after every system has run.
   * No-ops when Memory.stats isn't set up yet — tick() is called directly in some unit tests, without
   * migrateMemory() having run first. */
  flush(): void {
    if (Memory.stats) Memory.stats.cpu = cpuBySystem;
  }
};
