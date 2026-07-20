// ALL memory interfaces — single source of truth (docs/rewrite-skeleton.md §3).
//
// Rules:
// - Every field is owned by exactly one system (noted per field). Other systems
//   read it through the snapshot, never write it.
// - Store Id<T>; the snapshot builder resolves them and clears fields whose ids
//   no longer resolve, so planners never see stale ids.
// - migrate.ts versions each top-level section independently.
// - No spawn queue in memory — desired census is recomputed every tick.

import type { TaskState } from "../behaviors/types";

declare global {
  interface Memory {
    version: number;
    colonies: Record<string, ColonyMemory>;
    scouting: ScoutingMemory;
    expansion: ExpansionMemory;
    stats: StatsMemory;
  }

  interface CreepMemory {
    home: string; // colony room name
    role: RoleName;
    task?: TaskState; // current behavior progress — owned by behaviors/interpreter.ts
  }

  interface RoomMemory {
    scouted?: ScoutInfo; // written by scouting system only
  }
}

export type RoleName =
  | "bootstrap"
  | "miner"
  | "hauler"
  | "supply"
  | "upgrader"
  | "builder"
  | "sitter"
  | "scout"
  | "claimer"
  | "pioneer";

export interface ColonyMemory {
  anchor?: { x: number; y: number }; // owned by building — bunker anchor from layout planner
  sources: Record<Id<Source>, SourceMemory>; // owned by mining
  links?: LinkNetworkMemory; // owned by links
  remotes: string[]; // owned by mining — remote mining room names (future)
  danger: number; // owned by defense — hostile-presence counter for emergency logic
}

export interface SourceMemory {
  containerId?: Id<StructureContainer>;
  linkId?: Id<StructureLink>;
  spot?: { x: number; y: number }; // mining position
}

export interface LinkNetworkMemory {
  storage?: Id<StructureLink>;
  controller?: Id<StructureLink>;
  sources: Id<StructureLink>[];
}

export interface ScoutInfo {
  tick: number; // Game.time when last scouted
  sources: number;
  owner?: string;
  hostile: boolean;
}

// Section memories below are placeholders until their systems are ported
// (scouting/expansion in P4, stats alongside kernel/stats.ts).

export interface ScoutingMemory {
  version: number;
}

export interface ExpansionMemory {
  version: number;
}

export interface StatsMemory {
  version: number;
}
