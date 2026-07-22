// ALL memory interfaces — single source of truth. Each field is owned by exactly one system; other
// systems read it through the snapshot, never write it. Store Id<T> — the snapshot builder
// resolves them and clears fields whose ids no longer resolve. No spawn queue in memory — desired
// census is recomputed every tick.

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
    // The requester that ordered this creep, as `kind:room` (see opName). Absent means unowned —
    // a creep that predates its requester, cleared by attrition rather than migration.
    op?: string;
    // Singular: an RCL7+ two-source miner does not exist here, so the honest port is one assignment.
    sourceId?: Id<Source>;
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
  anchor?: { x: number; y: number }; // owned by building
  sources: Record<Id<Source>, SourceMemory>; // owned by mining
  links?: LinkNetworkMemory; // owned by links
  remotes: string[]; // owned by mining (future)
  danger: number; // owned by defense
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

// Placeholders until their systems are ported.

export interface ScoutingMemory {
  version: number;
}

export interface ExpansionMemory {
  version: number;
}

export interface StatsMemory {
  version: number;
}
