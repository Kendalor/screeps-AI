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
  RESOURCE_HYDROGEN: "H",
  RESOURCE_OXYGEN: "O",
  RESOURCE_UTRIUM: "U",
  RESOURCE_LEMERGIUM: "L",
  RESOURCE_KEANIUM: "K",
  RESOURCE_ZYNTHIUM: "Z",
  RESOURCE_CATALYST: "X",
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

  // Mineral reaction recipes + per-unit reaction time, from screeps/common constants — used by
  // src/empire/market.ts's manufacturingCost() to recursively price compounds.
  REACTIONS: {
    H: { O: "OH", L: "LH", K: "KH", U: "UH", Z: "ZH", G: "GH" },
    O: { H: "OH", L: "LO", K: "KO", U: "UO", Z: "ZO", G: "GO" },
    Z: { K: "ZK", H: "ZH", O: "ZO" },
    L: { U: "UL", H: "LH", O: "LO" },
    K: { Z: "ZK", H: "KH", O: "KO" },
    G: { H: "GH", O: "GO" },
    U: { L: "UL", H: "UH", O: "UO" },
    OH: {
      UH: "UH2O", UO: "UHO2", ZH: "ZH2O", ZO: "ZHO2",
      KH: "KH2O", KO: "KHO2", LH: "LH2O", LO: "LHO2", GH: "GH2O", GO: "GHO2"
    },
    X: {
      UH2O: "XUH2O", UHO2: "XUHO2", LH2O: "XLH2O", LHO2: "XLHO2",
      KH2O: "XKH2O", KHO2: "XKHO2", ZH2O: "XZH2O", ZHO2: "XZHO2", GH2O: "XGH2O", GHO2: "XGHO2"
    },
    ZK: { UL: "G" },
    UL: { ZK: "G" },
    LH: { OH: "LH2O" },
    ZH: { OH: "ZH2O" },
    GH: { OH: "GH2O" },
    KH: { OH: "KH2O" },
    UH: { OH: "UH2O" },
    LO: { OH: "LHO2" },
    ZO: { OH: "ZHO2" },
    KO: { OH: "KHO2" },
    UO: { OH: "UHO2" },
    GO: { OH: "GHO2" },
    LH2O: { X: "XLH2O" },
    KH2O: { X: "XKH2O" },
    ZH2O: { X: "XZH2O" },
    UH2O: { X: "XUH2O" },
    GH2O: { X: "XGH2O" },
    LHO2: { X: "XLHO2" },
    UHO2: { X: "XUHO2" },
    KHO2: { X: "XKHO2" },
    ZHO2: { X: "XZHO2" },
    GHO2: { X: "XGHO2" }
  },
  REACTION_TIME: {
    OH: 20, ZK: 5, UL: 5, G: 5,
    UH: 10, UH2O: 5, XUH2O: 60,
    UO: 10, UHO2: 5, XUHO2: 60,
    KH: 10, KH2O: 5, XKH2O: 60,
    KO: 10, KHO2: 5, XKHO2: 60,
    LH: 15, LH2O: 10, XLH2O: 65,
    LO: 10, LHO2: 5, XLHO2: 60,
    ZH: 20, ZH2O: 40, XZH2O: 160,
    ZO: 10, ZHO2: 5, XZHO2: 60,
    GH: 10, GH2O: 15, XGH2O: 80,
    GO: 10, GHO2: 30, XGHO2: 150
  },

  // Every Lab.runReaction() call consumes/produces this many units regardless of which reaction, from
  // screeps/common constants — REACTION_TIME above is the cooldown for one such call, i.e. one batch.
  LAB_REACTION_AMOUNT: 5,

  // gh #59's empire logistics: real engine values from @screeps/common/lib/constants.js (verified, not
  // recalled — see docs/empire-logistics-plan.md's own header note on this).
  TERMINAL_COOLDOWN: 10,
  TERMINAL_MIN_SEND: 100,

  // Full factory commodity recipe table, copied verbatim from node_modules/@screeps/common's
  // lib/constants.js (the pserver's own copy of the real engine data — see docs.screeps.com/resources.html
  // for the human-readable chain diagrams). Used by src/empire/market.ts's manufacturingCost() for
  // factory-produced goods, not just lab reactions. Note raw minerals (U/L/Z/K/G/O/H/X) and energy DO
  // have entries here too — each bar/compound has a reverse "decompress" recipe back to its mineral.
  COMMODITIES: {
    utrium_bar: { amount: 100, cooldown: 20, components: { U: 500, energy: 200 } },
    U: { amount: 500, cooldown: 20, components: { utrium_bar: 100, energy: 200 } },
    lemergium_bar: { amount: 100, cooldown: 20, components: { L: 500, energy: 200 } },
    L: { amount: 500, cooldown: 20, components: { lemergium_bar: 100, energy: 200 } },
    zynthium_bar: { amount: 100, cooldown: 20, components: { Z: 500, energy: 200 } },
    Z: { amount: 500, cooldown: 20, components: { zynthium_bar: 100, energy: 200 } },
    keanium_bar: { amount: 100, cooldown: 20, components: { K: 500, energy: 200 } },
    K: { amount: 500, cooldown: 20, components: { keanium_bar: 100, energy: 200 } },
    ghodium_melt: { amount: 100, cooldown: 20, components: { G: 500, energy: 200 } },
    G: { amount: 500, cooldown: 20, components: { ghodium_melt: 100, energy: 200 } },
    oxidant: { amount: 100, cooldown: 20, components: { O: 500, energy: 200 } },
    O: { amount: 500, cooldown: 20, components: { oxidant: 100, energy: 200 } },
    reductant: { amount: 100, cooldown: 20, components: { H: 500, energy: 200 } },
    H: { amount: 500, cooldown: 20, components: { reductant: 100, energy: 200 } },
    purifier: { amount: 100, cooldown: 20, components: { X: 500, energy: 200 } },
    X: { amount: 500, cooldown: 20, components: { purifier: 100, energy: 200 } },
    battery: { amount: 50, cooldown: 10, components: { energy: 600 } },
    energy: { amount: 500, cooldown: 10, components: { battery: 50 } },

    composite: { level: 1, amount: 20, cooldown: 50, components: { utrium_bar: 20, zynthium_bar: 20, energy: 20 } },
    crystal: { level: 2, amount: 6, cooldown: 21, components: { lemergium_bar: 6, keanium_bar: 6, purifier: 6, energy: 45 } },
    liquid: { level: 3, amount: 12, cooldown: 60, components: { oxidant: 12, reductant: 12, ghodium_melt: 12, energy: 90 } },

    wire: { amount: 20, cooldown: 8, components: { utrium_bar: 20, silicon: 100, energy: 40 } },
    switch: { level: 1, amount: 5, cooldown: 70, components: { wire: 40, oxidant: 95, utrium_bar: 35, energy: 20 } },
    transistor: { level: 2, amount: 1, cooldown: 59, components: { switch: 4, wire: 15, reductant: 85, energy: 8 } },
    microchip: { level: 3, amount: 1, cooldown: 250, components: { transistor: 2, composite: 50, wire: 117, purifier: 25, energy: 16 } },
    circuit: { level: 4, amount: 1, cooldown: 800, components: { microchip: 1, transistor: 5, switch: 4, oxidant: 115, energy: 32 } },
    device: { level: 5, amount: 1, cooldown: 600, components: { circuit: 1, microchip: 3, crystal: 110, ghodium_melt: 150, energy: 64 } },

    cell: { amount: 20, cooldown: 8, components: { lemergium_bar: 20, biomass: 100, energy: 40 } },
    phlegm: { level: 1, amount: 2, cooldown: 35, components: { cell: 20, oxidant: 36, lemergium_bar: 16, energy: 8 } },
    tissue: { level: 2, amount: 2, cooldown: 164, components: { phlegm: 10, cell: 10, reductant: 110, energy: 16 } },
    muscle: { level: 3, amount: 1, cooldown: 250, components: { tissue: 3, phlegm: 3, zynthium_bar: 50, reductant: 50, energy: 16 } },
    organoid: { level: 4, amount: 1, cooldown: 800, components: { muscle: 1, tissue: 5, purifier: 208, oxidant: 256, energy: 32 } },
    organism: { level: 5, amount: 1, cooldown: 600, components: { organoid: 1, liquid: 150, tissue: 6, cell: 310, energy: 64 } },

    alloy: { amount: 20, cooldown: 8, components: { zynthium_bar: 20, metal: 100, energy: 40 } },
    tube: { level: 1, amount: 2, cooldown: 45, components: { alloy: 40, zynthium_bar: 16, energy: 8 } },
    fixtures: { level: 2, amount: 1, cooldown: 115, components: { composite: 20, alloy: 41, oxidant: 161, energy: 8 } },
    frame: { level: 3, amount: 1, cooldown: 125, components: { fixtures: 2, tube: 4, reductant: 330, zynthium_bar: 31, energy: 16 } },
    hydraulics: { level: 4, amount: 1, cooldown: 800, components: { liquid: 150, fixtures: 3, tube: 15, purifier: 208, energy: 32 } },
    machine: { level: 5, amount: 1, cooldown: 600, components: { hydraulics: 1, frame: 2, fixtures: 3, tube: 12, energy: 64 } },

    condensate: { amount: 20, cooldown: 8, components: { keanium_bar: 20, mist: 100, energy: 40 } },
    concentrate: { level: 1, amount: 3, cooldown: 41, components: { condensate: 30, keanium_bar: 15, reductant: 54, energy: 12 } },
    extract: { level: 2, amount: 2, cooldown: 128, components: { concentrate: 10, condensate: 30, oxidant: 60, energy: 16 } },
    spirit: { level: 3, amount: 1, cooldown: 200, components: { extract: 2, concentrate: 6, reductant: 90, purifier: 20, energy: 16 } },
    emanation: { level: 4, amount: 1, cooldown: 800, components: { spirit: 2, extract: 2, concentrate: 3, keanium_bar: 112, energy: 32 } },
    essence: { level: 5, amount: 1, cooldown: 600, components: { emanation: 1, spirit: 3, crystal: 110, ghodium_melt: 150, energy: 64 } }
  },

  FIND_CREEPS: 101,
  FIND_MY_CREEPS: 102,
  FIND_HOSTILE_CREEPS: 103,
  FIND_SOURCES_ACTIVE: 104,
  FIND_SOURCES: 105,
  FIND_MINERALS: 116,
  FIND_DROPPED_RESOURCES: 106,
  FIND_STRUCTURES: 107,
  FIND_MY_STRUCTURES: 108,
  FIND_HOSTILE_STRUCTURES: 109,
  FIND_CONSTRUCTION_SITES: 111,
  FIND_MY_CONSTRUCTION_SITES: 114,
  FIND_HOSTILE_CONSTRUCTION_SITES: 115,
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
  STRUCTURE_KEEPER_LAIR: "keeperLair",
  STRUCTURE_EXTRACTOR: "extractor",

  EFFECT_COLLAPSE_TIMER: 1002,

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

  // Bucket cost of one pixel via Game.cpu.generatePixel(), from screeps/common constants.
  PIXEL_CPU_COST: 10000,

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
