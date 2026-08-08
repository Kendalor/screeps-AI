// Stubs the Screeps global constants for unit tests; @types/screeps declares them as
// ambient globals normally provided by the game engine at runtime. Add as src/ needs more.

import { parseRoomName } from "../src/lib/roomName";

// A per-tile registry the RoomPosition stub reads for lookFor(). Tests populate it via
// stubTile(); it's cleared each stubGame() so state never leaks between tests.
const tileLooks = new Map<string, Record<string, unknown[]>>();

export function stubTile(roomName: string, x: number, y: number, looks: Record<string, unknown[]>): void {
  tileLooks.set(`${roomName}:${x}:${y}`, looks);
}

export function clearTiles(): void {
  tileLooks.clear();
  pathFinderSearch = undefined;
}

// Room-name-relative tile in a flat world coordinate space (rooms tile edge-to-edge, W/E and N/S
// mirrored around the origin — the same lattice roomLinearDistance's axis() encodes at room granularity).
// Lets getDirectionTo below work correctly across a room boundary, not just within one room.
function worldX(roomName: string, tileX: number): number {
  const { wx, x } = parseRoomName(roomName);
  return wx === "E" ? x * 50 + tileX : tileX - 50 * (x + 1);
}
function worldY(roomName: string, tileY: number): number {
  const { wy, y } = parseRoomName(roomName);
  return wy === "S" ? y * 50 + tileY : tileY - 50 * (y + 1);
}

const DIRECTION_BY_DELTA: Record<string, number> = {
  "0,-1": 1, "1,-1": 2, "1,0": 3, "1,1": 4,
  "0,1": 5, "-1,1": 6, "-1,0": 7, "-1,-1": 8
};

class RoomPositionStub {
  constructor(
    public x: number,
    public y: number,
    public roomName: string
  ) {}
  lookFor(type: string): unknown[] {
    return tileLooks.get(`${this.roomName}:${this.x}:${this.y}`)?.[type] ?? [];
  }
  isEqualTo(other: { x: number; y: number; roomName: string }): boolean {
    return this.x === other.x && this.y === other.y && this.roomName === other.roomName;
  }
  // Real RoomPosition.inRangeTo accepts either a position or any RoomObject-shaped thing with a `.pos`.
  inRangeTo(target: { x: number; y: number; roomName: string } | { pos: { x: number; y: number; roomName: string } }, range: number): boolean {
    const other = "pos" in target ? target.pos : target;
    return this.roomName === other.roomName && Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y)) <= range;
  }
  // Real RoomPosition.getRangeTo also accepts (x, y) or a position/RoomObject-shaped thing.
  getRangeTo(targetOrX: number | { x: number; y: number } | { pos: { x: number; y: number } }, y?: number): number {
    if (typeof targetOrX === "number") return Math.max(Math.abs(this.x - targetOrX), Math.abs(this.y - (y ?? 0)));
    const other = "pos" in targetOrX ? targetOrX.pos : targetOrX;
    return Math.max(Math.abs(this.x - other.x), Math.abs(this.y - other.y));
  }
  getDirectionTo(target: { x: number; y: number; roomName: string }): number {
    const dx = Math.sign(worldX(target.roomName, target.x) - worldX(this.roomName, this.x));
    const dy = Math.sign(worldY(target.roomName, target.y) - worldY(this.roomName, this.y));
    return DIRECTION_BY_DELTA[`${dx},${dy}`];
  }
  // Scans the stubbed tiles in the square around this position — only tiles set via stubTile() carry
  // anything, everything else is empty, same as a freshly-generated room with no structures placed.
  findInRange(find: number, range: number, opts?: { filter?: (o: { structureType?: string }) => boolean }): unknown[] {
    const look = find === FIND_STRUCTURES ? "structure" : find === FIND_MY_CONSTRUCTION_SITES ? "constructionSite" : "structure";
    const results: unknown[] = [];
    for (let x = Math.max(0, this.x - range); x <= Math.min(49, this.x + range); x++) {
      for (let y = Math.max(0, this.y - range); y <= Math.min(49, this.y + range); y++) {
        for (const o of tileLooks.get(`${this.roomName}:${x}:${y}`)?.[look] ?? []) {
          if (!opts?.filter || opts.filter(o as { structureType?: string })) results.push(o);
        }
      }
    }
    return results;
  }
}

// PathFinder.search is scripted per-test via stubPathFinder(); tests that don't call it will error loudly
// if code under test reaches PathFinder.search anyway, rather than silently returning nonsense.
interface PathFinderResultStub {
  path: RoomPositionStub[];
  incomplete: boolean;
  ops: number;
  cost: number;
}
let pathFinderSearch: ((origin: unknown, goal: unknown, opts: unknown) => PathFinderResultStub) | undefined;

export function stubPathFinder(fn: (origin: unknown, goal: unknown, opts: unknown) => PathFinderResultStub): void {
  pathFinderSearch = fn;
}

// A real single-room Dijkstra over the CostMatrix a roomCallback returns — a genuine engine-behavior
// shim (same spirit as this file's RoomPositionStub), not a production-logic stand-in: it walks
// whatever cost matrix the code under test already builds, the same way the real PathFinder.search
// would within one room, but never stitches across a room border itself (single-room callers only —
// see squad-movement-cached-pathfinder-plan.md's hard constraint on hand-rolled cross-room arithmetic;
// a caller needing real border-crossing must run against the real engine, see test/integration/).
// Throws if origin/goal ever land in different rooms, so a test that accidentally needs cross-room
// stitching fails loudly instead of silently getting a same-room-only answer.
export function stubPathFinderSingleRoom(): void {
  pathFinderSearch = (originArg, goalArg, optsArg) => {
    const origin = originArg as { x: number; y: number; roomName: string };
    const opts = optsArg as {
      roomCallback: (roomName: string) => { get(x: number, y: number): number } | false;
      plainCost?: number;
      swampCost?: number;
    };
    const goals: { pos: { x: number; y: number; roomName: string }; range: number }[] =
      "pos" in (goalArg as object)
        ? [goalArg as { pos: { x: number; y: number; roomName: string }; range: number }]
        : (goalArg as { pos: { x: number; y: number; roomName: string }; range: number }[]);
    if (goals.some(g => g.pos.roomName !== origin.roomName)) {
      throw new Error(
        "stubPathFinderSingleRoom(): origin/goal in different rooms — this stub never stitches " +
          "across a room border; use a real-engine integration test for cross-room routing"
      );
    }
    const room = origin.roomName;
    const matrix = opts.roomCallback(room);
    const plainCost = opts.plainCost ?? 1;
    const cost = (x: number, y: number): number => {
      if (x < 0 || x > 49 || y < 0 || y > 49) return Infinity;
      const c = matrix ? matrix.get(x, y) : 0;
      if (c === 0xff) return Infinity;
      return c > 0 ? c : plainCost;
    };
    const key = (x: number, y: number): number => x * 50 + y;
    const dist = new Map<number, number>();
    const prev = new Map<number, number>();
    const startKey = key(origin.x, origin.y);
    dist.set(startKey, 0);
    // A tiny binary-heap-free Dijkstra (grid is only 2500 tiles) — a linear scan for the min each round
    // is trivial at this scale and keeps this stub simple.
    const visited = new Set<number>();
    const goalReached = (x: number, y: number): boolean =>
      goals.some(g => Math.max(Math.abs(x - g.pos.x), Math.abs(y - g.pos.y)) <= g.range);
    let reachedKey: number | undefined = goalReached(origin.x, origin.y) ? startKey : undefined;
    while (reachedKey === undefined) {
      let bestKey = -1;
      let bestDist = Infinity;
      for (const [k, d] of dist) {
        if (visited.has(k)) continue;
        if (d < bestDist) {
          bestDist = d;
          bestKey = k;
        }
      }
      if (bestKey === -1) break; // exhausted — no path
      visited.add(bestKey);
      const bx = Math.floor(bestKey / 50);
      const by = bestKey % 50;
      if (goalReached(bx, by)) {
        reachedKey = bestKey;
        break;
      }
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nx = bx + dx;
          const ny = by + dy;
          if (nx < 0 || nx > 49 || ny < 0 || ny > 49) continue;
          const stepCost = cost(nx, ny);
          if (!Number.isFinite(stepCost)) continue;
          const nk = key(nx, ny);
          if (visited.has(nk)) continue;
          const nd = bestDist + stepCost;
          if (nd < (dist.get(nk) ?? Infinity)) {
            dist.set(nk, nd);
            prev.set(nk, bestKey);
          }
        }
      }
    }
    if (reachedKey === undefined) return { path: [], incomplete: true, ops: visited.size, cost: 0 };
    const pathKeys: number[] = [];
    let cur = reachedKey;
    while (cur !== startKey) {
      pathKeys.push(cur);
      const p = prev.get(cur);
      if (p === undefined) break;
      cur = p;
    }
    pathKeys.reverse();
    const path = pathKeys.map(k => new RoomPositionStub(Math.floor(k / 50), k % 50, room));
    return { path, incomplete: false, ops: visited.size, cost: dist.get(reachedKey) ?? 0 };
  };
}

// Minimal stand-in for the engine's PathFinder.CostMatrix — just enough get/set/clone for a
// roomCallback to seed costs onto and for a test to read back what code under test set.
class CostMatrixStub {
  private readonly costs = new Map<number, number>();
  set(x: number, y: number, cost: number): void {
    this.costs.set(x * 50 + y, cost);
  }
  get(x: number, y: number): number {
    return this.costs.get(x * 50 + y) ?? 0;
  }
  clone(): CostMatrixStub {
    const copy = new CostMatrixStub();
    for (const [k, v] of this.costs) copy.costs.set(k, v);
    return copy;
  }
}

Object.assign(globalThis, {
  RoomPosition: RoomPositionStub,

  PathFinder: {
    CostMatrix: CostMatrixStub,
    search: (origin: unknown, goal: unknown, opts: unknown): PathFinderResultStub => {
      if (!pathFinderSearch) throw new Error("PathFinder.search called without stubPathFinder()");
      return pathFinderSearch(origin, goal, opts);
    }
  },

  OK: 0,
  ERR_NOT_OWNER: -1,
  ERR_NO_PATH: -2,
  ERR_NAME_EXISTS: -3,
  ERR_BUSY: -4,
  ERR_NOT_FOUND: -5,
  ERR_NOT_ENOUGH_ENERGY: -6,
  ERR_NOT_ENOUGH_RESOURCES: -6,
  ERR_INVALID_TARGET: -7,
  ERR_FULL: -8,
  ERR_NOT_IN_RANGE: -9,
  ERR_INVALID_ARGS: -10,
  ERR_TIRED: -11,
  ERR_NO_BODYPART: -12,
  ERR_RCL_NOT_ENOUGH: -14,
  ERR_GCL_NOT_ENOUGH: -15,
  ERR_ACCESS_DENIED: -16,

  RESOURCE_ENERGY: "energy",
  RESOURCE_OXYGEN: "O",
  RESOURCE_LEMERGIUM_OXIDE: "LO",
  RESOURCE_LEMERGIUM_ALKALIDE: "LHO2",
  RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE: "XLHO2",
  RESOURCE_UTRIUM_HYDRIDE: "UH",
  RESOURCE_UTRIUM_ACID: "UH2O",
  RESOURCE_CATALYZED_UTRIUM_ACID: "XUH2O",
  RESOURCE_KEANIUM_OXIDE: "KO",
  RESOURCE_KEANIUM_ALKALIDE: "KHO2",
  RESOURCE_CATALYZED_KEANIUM_ALKALIDE: "XKHO2",
  RESOURCE_GHODIUM_OXIDE: "GO",
  RESOURCE_GHODIUM_ALKALIDE: "GHO2",
  RESOURCE_CATALYZED_GHODIUM_ALKALIDE: "XGHO2",

  FIND_CREEPS: 101,
  FIND_MY_CREEPS: 102,
  FIND_HOSTILE_CREEPS: 103,
  FIND_SOURCES_ACTIVE: 104,
  FIND_SOURCES: 105,
  FIND_MINERALS: 116,
  FIND_DROPPED_RESOURCES: 106,
  FIND_STRUCTURES: 107,
  FIND_MY_STRUCTURES: 108,
  FIND_CONSTRUCTION_SITES: 111,
  FIND_MY_CONSTRUCTION_SITES: 114,
  FIND_TOMBSTONES: 118,
  FIND_RUINS: 123,

  LOOK_CREEPS: "creep",
  LOOK_STRUCTURES: "structure",

  TOP: 1,
  TOP_RIGHT: 2,
  RIGHT: 3,
  BOTTOM_RIGHT: 4,
  BOTTOM: 5,
  BOTTOM_LEFT: 6,
  LEFT: 7,
  TOP_LEFT: 8,

  TERRAIN_MASK_WALL: 1,
  TERRAIN_MASK_SWAMP: 2,

  STRUCTURE_SPAWN: "spawn",
  STRUCTURE_EXTENSION: "extension",
  STRUCTURE_ROAD: "road",
  STRUCTURE_WALL: "constructedWall",
  STRUCTURE_RAMPART: "rampart",
  STRUCTURE_LINK: "link",
  STRUCTURE_STORAGE: "storage",
  STRUCTURE_TOWER: "tower",
  STRUCTURE_CONTAINER: "container",
  STRUCTURE_CONTROLLER: "controller",
  STRUCTURE_TERMINAL: "terminal",
  STRUCTURE_INVADER_CORE: "invaderCore",

  // Real engine's OBSTACLE_OBJECT_TYPES (@screeps/common constants) — structureType/type values a creep
  // can never walk onto. Kept in sync by hand; snapshot/colony.ts's drainOccupancyFor is the one production
  // consumer at unit-test level.
  OBSTACLE_OBJECT_TYPES: [
    "spawn", "creep", "powerCreep", "source", "mineral", "deposit", "controller", "constructedWall",
    "extension", "link", "storage", "tower", "observer", "powerSpawn", "powerBank", "lab", "terminal",
    "nuker", "factory", "invaderCore"
  ],

  MAX_CONSTRUCTION_SITES: 100,

  EVENT_ATTACK: 1,
  EVENT_OBJECT_DESTROYED: 2,
  EVENT_ATTACK_CONTROLLER: 3,
  EVENT_BUILD: 4,
  EVENT_HARVEST: 5,
  EVENT_HEAL: 6,

  // Ticks to spawn one body part, from screeps/common constants.
  CREEP_SPAWN_TIME: 3,

  // A WORK part harvests this much energy per tick, from screeps/common constants.
  HARVEST_POWER: 2,

  // Creep lifespan in ticks, from screeps/common constants — the horizon body-cost upkeep amortizes over.
  CREEP_LIFE_TIME: 1500,

  // A creep with a CLAIM part lives a shorter life than normal, from screeps/common constants — the
  // horizon a claimer's body cost actually amortizes over (not CREEP_LIFE_TIME).
  CREEP_CLAIM_LIFE_TIME: 600,

  // Energy a source refills per regen cycle: 3000 for an owned/reserved room, 1500 for a neutral one,
  // 4000 for a keeper-guarded source (keeper rooms have no reservation state, just this one fixed rate).
  SOURCE_ENERGY_CAPACITY: 3000,
  SOURCE_ENERGY_NEUTRAL_CAPACITY: 1500,
  SOURCE_ENERGY_KEEPER_CAPACITY: 4000,
  ENERGY_REGEN_TIME: 300, // so reserved => 3000/300 = 10/tick, unreserved => 5/tick, keeper => 4000/300 ~= 13.33/tick

  // A CARRY part holds this much, from screeps/common constants — sizes the haul body.
  CARRY_CAPACITY: 50,

  // Road decay: loses ROAD_DECAY_AMOUNT hits every ROAD_DECAY_TIME ticks (on plain terrain).
  ROAD_DECAY_AMOUNT: 100,
  ROAD_DECAY_TIME: 1000,

  // Container decay: loses CONTAINER_DECAY hits every CONTAINER_DECAY_TIME ticks. Remote (unowned)
  // rooms use the shorter unowned interval; the owned interval is 5x longer.
  CONTAINER_DECAY: 5000,
  CONTAINER_DECAY_TIME: 100,
  CONTAINER_DECAY_TIME_OWNED: 500,

  // Hits repaired per energy spent, from screeps/common constants — the metrics repair-energy conversion.
  REPAIR_POWER: 100,

  // Damage a single RANGED_ATTACK part deals via rangedAttack(), flat anywhere within range 3, from
  // screeps/common constants.
  RANGED_ATTACK_POWER: 10,

  // Damage a single ATTACK part deals in melee, from screeps/common constants.
  ATTACK_POWER: 30,

  // Spawn cost per body part, from screeps/common constants.
  BODYPART_COST: {
    move: 50,
    work: 100,
    attack: 80,
    carry: 50,
    heal: 250,
    ranged_attack: 150,
    tough: 10,
    claim: 600
  },

  WORK: "work",
  CARRY: "carry",
  MOVE: "move",
  ATTACK: "attack",
  RANGED_ATTACK: "ranged_attack",
  HEAL: "heal",
  CLAIM: "claim",
  TOUGH: "tough",

  // Per-RCL structure count limits, from screeps/common constants.
  CONTROLLER_STRUCTURES: {
    spawn: { 0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 3 },
    extension: { 0: 0, 1: 0, 2: 5, 3: 10, 4: 20, 5: 30, 6: 40, 7: 50, 8: 60 },
    link: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 2, 6: 3, 7: 4, 8: 6 },
    road: { 0: 2500, 1: 2500, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500 },
    constructedWall: { 1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500 },
    rampart: { 1: 0, 2: 2500, 3: 2500, 4: 2500, 5: 2500, 6: 2500, 7: 2500, 8: 2500 },
    storage: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1 },
    tower: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 6 },
    observer: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1 },
    powerSpawn: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1 },
    extractor: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1 },
    terminal: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1, 8: 1 },
    lab: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 3, 7: 6, 8: 10 },
    container: { 0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5 },
    nuker: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1 },
    factory: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1, 8: 1 }
  }
});
