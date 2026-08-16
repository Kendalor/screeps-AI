// Builds a minimal Game global for kernel/actuator tests. Most planner tests don't need this — they
// take plain snapshot fixtures — but construction/planner.ts's findPath calls Game.map.getRoomTerrain
// for any REMOTE room's matrix (terrainFromGame; the home room reads colony.terrain instead), so any
// planner test exercising a remote-room findPath call needs this stubbed too.

export interface GameStubOptions {
  time?: number;
  cpuLimit?: number;
  bucket?: number;
  /** Called for Game.cpu.getUsed() — return rising values to simulate load. */
  getUsed?: () => number;
  /** Called for Game.cpu.generatePixel() — defaults to OK. */
  generatePixel?: () => ScreepsReturnCode;
  /** Objects resolvable via Game.getObjectById. */
  objects?: Record<string, unknown>;
  rooms?: Record<string, unknown>;
  /** Game.map.getRoomLinearDistance(a, b) stub. Defaults to always 0 (same room). */
  roomLinearDistance?: (a: string, b: string) => number;
  /** Game.map.describeExits(roomName) stub. Defaults to no exits (undefined) for every room. */
  describeExits?: (roomName: string) => Partial<Record<string, string>> | undefined;
  /** Game.map.getRoomTerrain(roomName) stub. Defaults to a fully open room, every tile walkable. */
  getRoomTerrain?: (roomName: string) => { get(x: number, y: number): number };
}

export function stubGame(opts: GameStubOptions = {}): void {
  const objects = opts.objects ?? {};
  (globalThis as Record<string, unknown>).Game = {
    time: opts.time ?? 0,
    cpu: {
      limit: opts.cpuLimit ?? 20,
      bucket: opts.bucket ?? 10000,
      getUsed: opts.getUsed ?? (() => 0),
      generatePixel: opts.generatePixel ?? (() => OK)
    },
    rooms: opts.rooms ?? {},
    creeps: {},
    getObjectById: (id: string) => objects[id] ?? null,
    map: {
      getRoomLinearDistance: opts.roomLinearDistance ?? (() => 0),
      describeExits: opts.describeExits ?? (() => undefined),
      getRoomTerrain: opts.getRoomTerrain ?? (() => ({ get: () => 0 }))
    }
  };
  (globalThis as Record<string, unknown>).Memory = { creeps: {} };
}
