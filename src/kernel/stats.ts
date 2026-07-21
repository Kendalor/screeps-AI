// Per-system CPU accounting, read by the dashboard and flushed to Memory.stats.

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
  }
};
