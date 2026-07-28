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
  storeEnergy: number;
  storeCapacity: number;
}

import type { XY } from "../lib/geometry";
import type { RoleName, ScoutInfo } from "../memory/schema";
import type { RoomType } from "../lib/roomName";

export interface SnapSpawn {
  id: Id<StructureSpawn>;
  busy: boolean; // spawning right now
}

// A single spawn or extension as an energy sink, with its own store so the logistics graph can hand a
// transport creep one specific structure to reserve (and thereby remove from other creeps' options),
// rather than only the colony-wide energyAvailable/energyCapacity aggregate. Spawns and extensions
// share a type here because a hauler fills them identically — the "any spawn/extension with room" pool.
export interface SnapSink extends XY {
  id: Id<StructureSpawn | StructureExtension>;
  storeEnergy: number;
  storeCapacity: number;
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
  x: number; // creep.pos.x — lets a planner range-gate a creep (e.g. only upgraders near the controller)
  y: number; // creep.pos.y

  storeEnergy: number; // current carried energy — lets a planner tell a loaded creep from an empty one
  storeCapacity: number; // total store capacity across all resource types

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
  // id/hits/hitsMax are present for a built structure, absent for a construction site (which has
  // neither hits nor a stable structure id yet). Lets the Building operation tell whether any built
  // structure has decayed far enough to be worth a repairer, and lets Defense target it with towerRepair.
  id?: Id<Structure>;
  hits?: number;
  hitsMax?: number;
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

export interface SnapTombstone extends XY {
  id: Id<Tombstone>;
  storeEnergy: number;
}

// A room within scouting radius, as the Scouting operation sees it, built by walking the room graph at the snapshot boundary.
export interface ScoutCandidate {
  room: string;
  distance: number; // rooms from this colony (roomLinearDistance)
  type: RoomType;
  info?: ScoutInfo; // last recorded observation; absent means never scouted
}

// A room with vision this tick for any reason (owned, remote, a passing creep, a claimer) — not
// necessarily within scouting radius. Lets Scouting passively refresh sources/owner/tick on rooms no
// scout was ever dispatched to, without operations touching Game.rooms directly.
export interface VisibleRoom {
  room: string;
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
  // Per-structure spawn/extension sinks, so the logistics graph can reserve individual extensions for
  // one creep's multi-dropoff trip. energyAvailable/energyCapacity below remain the aggregate the fleet
  // sizing and spawn gating read — the two coexist, one for reservation, one for economy math.
  spawnSinks: SnapSink[];
  energyAvailable: number;
  energyCapacity: number;
  sources: SnapSource[];
  drops: SnapDrop[]; // ground-level energy from drop mining
  tombstones: SnapTombstone[]; // energy left behind by a dead creep
  terrain: Uint8Array; // 1 = walkable, 0 = wall, indexed [x*50+y]
  controller: XY; // controller position, so operations can path to it (e.g. the upgrade container)
  controllerLevel: number;
  controllerProgress: number;
  controllerProgressTotal: number; // progress needed to reach the next level; 0 at max RCL
  storageEnergy: number; // 0 when no storage built yet
  storageCapacity: number; // 0 when no storage built yet — total store capacity when it exists
  containers: SnapContainer[]; // empty until mining containers are built
  storageId?: Id<StructureStorage>; // absent until storage is built
  anchor: XY | null; // null until a bunker-fitting anchor is found in this room
  sourceMemory: Partial<Record<Id<Source>, SnapSourceMemory>>; // keyed by source id; missing means nothing recorded yet
  structures: SnapStructure[];
  sites: SnapStructure[];
  constructionProgress: number; // total work remaining across all sites in the room
  scoutTargets: ScoutCandidate[]; // rooms within scouting radius; empty until the frontier is walked
  visibleRooms: VisibleRoom[]; // every room with vision this tick, regardless of scouting radius
}

export interface EmpireSnapshot {
  tick: number;
  colonies: ColonySnapshot[];
}
