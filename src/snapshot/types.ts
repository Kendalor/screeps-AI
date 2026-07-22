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
import type { RoleName } from "../memory/schema";

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

export interface ColonySnapshot {
  name: string;
  towers: SnapTower[];
  hostiles: SnapUnit[];
  woundedFriendlies: SnapUnit[];
  safeModeAvailable: boolean;
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
  structures: SnapStructure[];
  sites: SnapStructure[];
  constructionProgress: number; // total work remaining across all sites in the room
}

export interface EmpireSnapshot {
  tick: number;
  colonies: ColonySnapshot[];
}
