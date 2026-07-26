// ALL memory interfaces. Each field is owned by exactly one system; others read it via the snapshot, never write it.

import type { RoomType } from "../lib/roomName";
import type { TaskState } from "../behaviors/types";

declare global {
  interface Memory {
    version: number;
    colonies: Record<string, ColonyMemory>;
    scouting: ScoutingMemory;
    expansion: ExpansionMemory;
    stats: StatsMemory;
    metrics: Record<string, ColonyMetricsMemory>; // cross-tick harvest-rate window; everything else in a report is derived fresh
  }

  interface CreepMemory {
    home: string; // colony room name
    role: RoleName;
    op?: string; // requester that ordered this creep, as `kind:room`; absent means unowned (predates its requester)
    sourceId?: Id<Source>; // singular — no multi-source miner assignment
    task?: TaskState; // current behavior progress — owned by behaviors/interpreter.ts
    scoutTarget?: string; // room a scout is assigned to reach; cleared by moveToRoom on arrival
    lastRoom?: string; // room a scout was standing in when last (re)assigned; avoided by the next pick unless it's the only option
    route?: RouteMemory; // precomputed room-by-room route for long-haul movement, walked by moveToRoom
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

// A room-by-room route and how far along it the creep is; `index` is the next room to enter.
export interface RouteMemory {
  dest: string; // guard against walking a stale route to elsewhere
  rooms: string[]; // ordered rooms to pass through, excluding the start
  index: number;
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

// One room as scouting last observed it. `type` is stored despite being derivable from the name, as a cheap pre-filter;
// an unvisited room carries its type with `tick` absent to mark it never actually seen.
export interface ScoutInfo {
  tick?: number; // Game.time when last physically seen; absent means classified-but-unvisited
  type: RoomType;
  sources: ScoutedSource[]; // the headline remote-mining input — id and position of each source
  mineral?: MineralConstant; // the room's mineral, if any (normal/keeper rooms)
  owner?: string; // controller owner's username, if owned/reserved
  hostile: boolean; // owned by someone other than us
}

// A source as seen from outside its room, before any colony claims it for mining.
export interface ScoutedSource {
  id: Id<Source>;
  x: number;
  y: number;
}

// How far out the frontier has pushed — the one piece of scouting state a tick cannot rederive. The todo list itself
// is recomputed every tick from the room graph, never stored.
export interface ScoutingMemory {
  radius: number; // current scouting radius in rooms; grows toward MAX_SCOUT_RANGE
}

export interface ExpansionMemory {
  version: number;
}

export interface StatsMemory {
  version: number;
}

// A short window of (tick, total source energy) samples; harvest rate is diffed oldest-vs-newest. A ring rather than a
// running total so a gap in vision self-heals instead of poisoning the average forever.
export interface ColonyMetricsMemory {
  harvestSamples: { tick: number; sourceEnergy: number }[]; // oldest first, capped at HARVEST_WINDOW entries
}
