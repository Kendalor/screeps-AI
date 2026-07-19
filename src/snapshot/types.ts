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

import type { RoleName } from "../memory/schema";

export interface SnapSpawn {
  id: Id<StructureSpawn>;
  busy: boolean; // spawning right now
}

export type Census = Partial<Record<RoleName, number>>;

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
}

export interface EmpireSnapshot {
  tick: number;
  colonies: ColonySnapshot[];
}
