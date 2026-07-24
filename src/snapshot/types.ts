// Snapshot shapes handed to planners: plain data only, so planners can never touch Game.*.

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

// One live creep, as a requester's satisfaction check sees it. No counts carried — different requesters project the same creeps differently.
export interface SnapCreep {
  id: Id<Creep>;
  name: string;
  body: BodyPartConstant[]; // live parts only (hits > 0)
  ticksToLive?: number; // undefined while spawning
  spawning: boolean;

  role: RoleName; // === memory.role
  home: string; // === memory.home
  room: string; // creep.pos.roomName — may differ from home (e.g. a scout on the frontier)

  // Live reference, deeply readonly: writing through it to Memory is a compile error, keeping Intent -> execute.ts the sole write boundary.
  memory: DeepReadonly<CreepMemory>;
}

// Compile-time-only deep readonly; no runtime Object.freeze.
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

// A room within scouting radius, as the Scouting operation sees it, built by walking the room graph at the snapshot boundary.
export interface ScoutCandidate {
  room: string;
  distance: number; // rooms from this colony (roomLinearDistance)
  type: RoomType;
  info?: ScoutInfo; // last recorded observation; absent means never scouted
}

// What mining last recorded for a source, so an operation can tell a real change from rewriting the same values.
export interface SnapSourceMemory {
  spot?: XY;
  containerId?: Id<StructureContainer>;
  linkId?: Id<StructureLink>;
}

export interface ColonySnapshot {
  name: string;
  tick: number; // mirrored Game.time, so operations can gate themselves to "is this my tick"
  towers: SnapTower[];
  hostiles: SnapUnit[];
  woundedFriendlies: SnapUnit[];
  safeModeAvailable: boolean;
  safeModeActive: number; // ticks remaining right now, 0 when inactive
  safeModeCount: number; // activations banked for later use
  creeps: SnapCreep[]; // alive + spawning creeps with memory.home this colony
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
  sourceMemory: Partial<Record<Id<Source>, SnapSourceMemory>>; // keyed by source id; missing means nothing recorded yet
  structures: SnapStructure[];
  sites: SnapStructure[];
  constructionProgress: number; // total work remaining across all sites in the room
  scoutTargets: ScoutCandidate[]; // rooms within scouting radius; empty until the frontier is walked
}

export interface EmpireSnapshot {
  tick: number;
  colonies: ColonySnapshot[];
}
