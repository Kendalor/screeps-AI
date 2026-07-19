// Builds a minimal Game global for kernel/actuator tests. Planner tests don't
// need this — they take plain snapshot fixtures.

export interface GameStubOptions {
  time?: number;
  cpuLimit?: number;
  bucket?: number;
  /** Called for Game.cpu.getUsed() — return rising values to simulate load. */
  getUsed?: () => number;
  /** Objects resolvable via Game.getObjectById. */
  objects?: Record<string, unknown>;
  rooms?: Record<string, unknown>;
}

export function stubGame(opts: GameStubOptions = {}): void {
  const objects = opts.objects ?? {};
  (globalThis as Record<string, unknown>).Game = {
    time: opts.time ?? 0,
    cpu: {
      limit: opts.cpuLimit ?? 20,
      bucket: opts.bucket ?? 10000,
      getUsed: opts.getUsed ?? (() => 0)
    },
    rooms: opts.rooms ?? {},
    creeps: {},
    getObjectById: (id: string) => objects[id] ?? null
  };
}
