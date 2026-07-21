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

export type Census = Partial<Record<RoleName, number>>;

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
  census: Census; // alive + spawning creeps per role in this colony
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
