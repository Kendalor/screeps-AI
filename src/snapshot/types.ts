// Snapshot shapes handed to planners. Plain data only — no live game objects —
// so planner tests are fixture objects and planners can never touch Game.*.
// Fields are added as the systems that read them are ported.

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
}

export interface ColonySnapshot {
  name: string;
  towers: SnapTower[];
  hostiles: SnapUnit[];
  woundedFriendlies: SnapUnit[];
  safeModeAvailable: boolean;
  // spawning inputs — filled by the census pass (snapshot/census.ts)
  census: Census; // alive + spawning creeps per role in this colony
  spawns: SnapSpawn[];
  energyAvailable: number;
  energyCapacity: number;
  sources: SnapSource[]; // sources in the room, with positions (mining pathing)
  terrain: Uint8Array; // 1 = walkable, 0 = wall, indexed [x*50+y] — road cost matrix input
  controllerLevel: number;
  controllerProgress: number;
  storageEnergy: number; // 0 when no storage built yet
  // logistics inputs (systems/logistics.ts) — the miner -> container -> hauler
  // -> storage chain. containers is empty until mining containers are built.
  containers: SnapContainer[];
  storageId?: Id<StructureStorage>; // absent until storage is built
  // building inputs (systems/building.ts) — anchor is resolved/cached against
  // ColonyMemory.anchor by snapshot/colony.ts, the only impure boundary.
  anchor: XY | null; // null until a bunker-fitting anchor is found in this room
  structures: SnapStructure[]; // built structures already in the room
  sites: SnapStructure[]; // construction sites already placed
  constructionProgress: number; // total work remaining across all sites in the room
}

export interface EmpireSnapshot {
  tick: number;
  colonies: ColonySnapshot[];
}
