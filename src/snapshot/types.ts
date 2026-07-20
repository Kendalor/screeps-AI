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
  sources: number; // source count in the room
  controllerLevel: number;
  controllerProgress: number;
  storageEnergy: number; // 0 when no storage built yet
  // building inputs (systems/building.ts) — anchor is resolved/cached against
  // ColonyMemory.anchor by snapshot/colony.ts, the only impure boundary.
  anchor: XY | null; // null until a bunker-fitting anchor is found in this room
  structures: SnapStructure[]; // built structures already in the room
  sites: SnapStructure[]; // construction sites already placed
}

export interface EmpireSnapshot {
  tick: number;
  colonies: ColonySnapshot[];
}
