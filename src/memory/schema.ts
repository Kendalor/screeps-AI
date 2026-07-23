// ALL memory interfaces — single source of truth. Each field is owned by exactly one system; other
// systems read it through the snapshot, never write it. Store Id<T> — the snapshot builder
// resolves them and clears fields whose ids no longer resolve. No spawn queue in memory — desired
// census is recomputed every tick.

import type { RoomType } from "../lib/roomName";
import type { TaskState } from "../behaviors/types";

declare global {
  interface Memory {
    version: number;
    colonies: Record<string, ColonyMemory>;
    scouting: ScoutingMemory;
    expansion: ExpansionMemory;
    stats: StatsMemory;
    // Cross-tick metric state, keyed by colony room name. Only the little that a single tick's
    // snapshot cannot recover lives here — the harvest-rate window. Everything else in a metrics
    // report is derived fresh each tick and never persisted.
    metrics: Record<string, ColonyMetricsMemory>;
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
    // The room a scout is currently walking to. Owned by the scout behaviour (empire/creeps.ts):
    // cleared on arrival so the behaviour picks the next unscouted room from its colony's todo.
    scoutTarget?: string;
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

// One room as scouting last observed it. Written only by the scout behaviour recording what it stood
// in (execute.ts's recordScout), read by remote-mining and expansion to decide what is worth
// claiming. The room *type* is stored even though it is derivable from the name — it is the cheap
// filter a reader applies before touching the rest, and storing it means an unvisited room already
// carries its type (set from the name) with `tick` absent to mark it never actually seen.
export interface ScoutInfo {
  tick?: number; // Game.time when last physically seen; absent means classified-but-unvisited
  type: RoomType;
  sources: number; // source count — the headline remote-mining input
  mineral?: MineralConstant; // the room's mineral, if any (normal/keeper rooms)
  owner?: string; // controller owner's username, if owned/reserved
  hostile: boolean; // owned by someone other than us
}

// The one piece of scouting state a single tick cannot rederive: how far out the frontier has
// pushed. Legacy grew the radius outward as rooms in the current ring were exhausted (todo empty ->
// radius+1). The todo list itself is NOT stored — it is recomputed every tick from the room graph
// and RoomMemory (the rewrite rejects legacy's persisted, drift-prone Operation.data.todo). Only the
// radius survives, so the frontier does not reset to 1 every restart.
export interface ScoutingMemory {
  radius: number; // current scouting radius in rooms; grows toward MAX_SCOUT_RANGE
}

export interface ExpansionMemory {
  version: number;
}

export interface StatsMemory {
  version: number;
}

// The one piece of metric state a single tick cannot rederive: a short window of (tick, total
// source energy) samples. Harvest rate is the drop in total source energy per tick, averaged over
// the window — so we keep the oldest and newest samples and diff them. Storing a ring rather than a
// single running total means a gap in vision (no snapshot for a stretch) self-heals: old samples
// age out instead of poisoning the average forever.
export interface ColonyMetricsMemory {
  // (tick, total source energy) samples, oldest first, capped at HARVEST_WINDOW entries.
  harvestSamples: { tick: number; sourceEnergy: number }[];
}
