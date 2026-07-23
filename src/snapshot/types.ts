// Snapshot shapes handed to planners. Plain data only — no live game objects — so planner tests
// are fixture objects and planners can never touch Game.*.

export interface SnapUnit {
  id: Id<Creep>;
  x: number;
  y: number;
  hits: number;
  hitsMax: number;
}

export interface SnapTower {
  id: Id<StructureTower>;
  x: number;
  y: number;
}

import type { XY } from "../lib/geometry";
import type { RoleName, ScoutInfo } from "../memory/schema";
import type { RoomType } from "../lib/roomName";

export interface SnapSpawn {
  id: Id<StructureSpawn>;
  busy: boolean; // spawning right now
}

// One live creep, as a requester's satisfaction check sees it. Counts are not carried: different
// requesters want different projections of the same creeps (WORK per source, CARRY per remote, TTL
// for pre-spawn), and an aggregate can only serve the one that was guessed at when it was written.
export interface SnapCreep {
  // From the live Creep — the only source for these.
  id: Id<Creep>;
  name: string;
  // Live parts only (hits > 0): a dead part harvests nothing, so countPart() answers what the caller means.
  body: BodyPartConstant[];
  ticksToLive?: number; // undefined while spawning
  spawning: boolean;

  // Shortcuts to the two memory fields read constantly. Never independently authoritative — if one
  // ever disagrees with memory, the snapshot builder is wrong.
  role: RoleName; // === memory.role
  home: string; // === memory.home
  // The room the creep currently stands in (creep.pos.roomName) — distinct from `home`, which is the
  // colony that funds it. A scout out on the frontier is in a room it does not call home; the
  // Scouting operation needs this to decide whether the scout has arrived and what room to record.
  room: string;

  // The whole memory object, live reference, deeply readonly. Not a deep copy: that would be a
  // stringify-per-creep-per-tick, and stale by design since behaviours write `task` every tick.
  // The readonly-ness costs nothing at runtime and makes a planner write to Memory a compile error,
  // keeping the Intent -> execute.ts boundary the single answer to "what wrote this field".
  //
  // Deep, not `Readonly<CreepMemory>`: that is shallow, so it would still permit
  // `memory.task.step = 3` — a mutation of live Memory through the exact nested field behaviours
  // own, which is the one case the boundary most needs to forbid.
  memory: DeepReadonly<CreepMemory>;
}

// Structural deep-readonly. Functions and primitives pass through untouched; arrays and plain
// objects are frozen recursively at the type level only (no runtime Object.freeze — this is a
// compile-time boundary, not a runtime one).
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export interface SnapStructure extends XY {
  type: BuildableStructureConstant;
}

export interface SnapContainer extends XY {
  id: Id<StructureContainer>;
  storeEnergy: number;
  storeCapacity: number;
}

export interface SnapSource extends XY {
  id: Id<Source>;
  openTiles: number; // walkable tiles adjacent to the source, i.e. its miner/collector share cap
}

export interface SnapDrop extends XY {
  id: Id<Resource>;
  amount: number;
}

// A room reachable within the current scouting radius, as the Scouting operation sees it: its name,
// its map-grid distance from this colony (for ranking the nearest todo), its type, and whatever
// scouting last recorded (`info`, absent if never seen). Built by walking the room graph at the
// snapshot boundary — the one place describeExits is touched — so the operation stays pure.
export interface ScoutCandidate {
  room: string;
  distance: number; // rooms from this colony (roomLinearDistance)
  type: RoomType;
  info?: ScoutInfo; // last recorded observation; absent means never scouted
}

// What mining has already recorded for a source, so an operation can tell a write that would change
// something from one that would rewrite the same values. Observed state — read back from Memory at
// the snapshot boundary, exactly like a structure is read from the room.
export interface SnapSourceMemory {
  spot?: XY;
  containerId?: Id<StructureContainer>;
  linkId?: Id<StructureLink>;
}

export interface ColonySnapshot {
  name: string;
  // Game.time, mirrored from the empire snapshot. Operations run every tick and gate themselves;
  // without this an operation could only ask "what is true", never "is this my tick".
  tick: number;
  towers: SnapTower[];
  hostiles: SnapUnit[];
  woundedFriendlies: SnapUnit[];
  safeModeAvailable: boolean;
  // Ticks of safe mode remaining right now, 0 when not active. Distinct from safeModeAvailable
  // (whether one *can* be triggered) — a colony can be mid-safe-mode with none left in reserve.
  safeModeActive: number;
  // How many safe-mode activations are banked for later use.
  safeModeCount: number;
  // Alive + spawning creeps that call this colony home (by memory.home, not by which room they
  // stand in). Spawning ones are included so a request isn't filled twice while its creep is still
  // in the spawn.
  creeps: SnapCreep[];
  spawns: SnapSpawn[];
  energyAvailable: number;
  energyCapacity: number;
  sources: SnapSource[];
  drops: SnapDrop[]; // ground-level energy from drop mining
  terrain: Uint8Array; // 1 = walkable, 0 = wall, indexed [x*50+y]
  controllerLevel: number;
  controllerProgress: number;
  storageEnergy: number; // 0 when no storage built yet
  containers: SnapContainer[]; // empty until mining containers are built
  storageId?: Id<StructureStorage>; // absent until storage is built
  anchor: XY | null; // null until a bunker-fitting anchor is found in this room
  // What mining recorded for each source last time it wrote. Keyed by source id; missing means
  // nothing recorded yet.
  sourceMemory: Partial<Record<Id<Source>, SnapSourceMemory>>;
  structures: SnapStructure[];
  sites: SnapStructure[];
  constructionProgress: number; // total work remaining across all sites in the room
  // Rooms within the current scouting radius of this colony, each carrying its last observation.
  // The Scouting operation ranks these into scout demand; empty until the frontier is walked.
  scoutTargets: ScoutCandidate[];
}

export interface EmpireSnapshot {
  tick: number;
  colonies: ColonySnapshot[];
}
