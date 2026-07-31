// ALL memory interfaces. Each field is owned by exactly one system; others read it via the snapshot, never write it.

import type { RoomType } from "../lib/roomName";
import type { TaskState } from "../behaviors/types";
import type { LogisticsTask } from "../logistics/types";
import type { LogLevel } from "../lib/log";

declare global {
  interface Memory {
    version: number;
    colonies: Record<string, ColonyMemory>;
    scouting: ScoutingMemory;
    expansion: ExpansionMemory;
    stats: StatsMemory;
    metrics: Record<string, ColonyMetricsMemory>; // cross-tick harvest-rate window; everything else in a report is derived fresh
    logLevel?: LogLevel; // set via the in-game console (commands/console.ts); absent means "error" only
    debugMetrics?: boolean; // set via the in-game console (commands/console.ts); toggles the right-aligned debug panel
  }

  interface CreepMemory {
    home: string; // colony room name
    role: RoleName;
    op?: string; // requester that ordered this creep, as `kind:room`; absent means unowned (predates its requester)
    sourceId?: Id<Source>; // singular — no multi-source miner assignment
    task?: TaskState; // current behavior progress — owned by behaviors/interpreter.ts
    // Current transport assignment — owned by intents/execute.ts (write) via Logistics.intents();
    // empire/creeps.ts's transport runner reads and consumes `current`, never writes it directly. The
    // whole trip is one chain (pickup -> ... -> deliver) nested in `current.next`; runTransport promotes
    // `current.next` as each leg completes, so there is no separate follow-up field here.
    logistics?: { current?: LogisticsTask };
    // The steward's current carry destination (storage/terminal), owned by behaviors/steward.ts alone —
    // no planner/intent involved, since a steward's job is decided and executed in the same tick with
    // nothing worth persisting across a re-plan (unlike transport's multi-leg chain).
    stewardDest?: Id<StructureStorage> | Id<StructureTerminal> | Id<StructureLink>;
    scoutTarget?: string; // room a scout is assigned to reach; cleared by moveToRoom on arrival
    targetRoom?: string; // a remote worker's permanent destination room (its source's room); NOT cleared on arrival, unlike scoutTarget
    // A builder's current cross-room construction assignment (home or a remote room with outstanding
    // sites), owned by operations/building.ts. Not cleared on arrival like scoutTarget: the builder keeps
    // working sites in this room until Building reassigns it once the room's backlog clears.
    buildTargetRoom?: string;
    // The repairer equivalent of buildTargetRoom: a repair creep's current cross-room upkeep assignment
    // (home or a remote room with tower-uncovered decay), owned by operations/repairing.ts. Same
    // not-cleared-on-arrival rule — the repairer keeps working this room until Repairing reassigns it.
    repairTargetRoom?: string;
    // The defender equivalent of repairTargetRoom: which invaded room (home or a remote) this defender is
    // currently sent to fight in, owned by operations/defense.ts. Same not-cleared-on-arrival rule — the
    // defender keeps fighting there until Defense reassigns it (danger cleared or a worse room appeared).
    defendTargetRoom?: string;
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
  | "transport"
  | "steward"
  | "upgrader"
  | "builder"
  | "repair"
  | "sitter"
  | "scout"
  | "claimer"
  | "pioneer"
  | "defender";

export interface ColonyMemory {
  anchor?: { x: number; y: number }; // owned by building
  sources: Record<Id<Source>, SourceMemory>; // owned by mining
  links?: LinkNetworkMemory; // owned by links
  remotes: RemoteMemory[]; // the selected remote rooms + their mined sources; owned by mining (pickRemotes writes it)
  danger: number; // owned by defense
}

// One remote room we've chosen to mine, cached in ColonyMemory so selection is stable and not re-ranked
// every tick. Written by the pickRemotes selector (throttled), read by the snapshot builder to fill
// ColonySnapshot.remoteSources.
export interface RemoteMemory {
  room: string;
  sources: RemoteSourceMemory[]; // the sources selected for mining in this room (a room may have unmined far sources)
  reserved: boolean; // are we currently reserving it (recomputed, cached to avoid thrash)
  // Game.time until which the room should still be treated as dangerous, even without current vision.
  // Set from the last-seen hostiles' own ticksToLive (see remoteRoomVision), so a room stays flagged for
  // exactly as long as the invader that chased our vision away is expected to still be standing in it —
  // not forever, and not reset to "safe" the instant the creep that saw it dies. Absent/past means safe.
  dangerUntil?: number;
}

// A selected remote source and the facts about it that survive across ticks without vision. Live per-tick
// fields (container energy, hostiles) are not stored here — the snapshot builder fills those only when a
// creep gives us vision of the remote room that tick.
export interface RemoteSourceMemory {
  id: Id<Source>;
  x: number;
  y: number;
  distance: number; // route length home->source, computed once at selection time (see mining/distance.ts)
  containerId?: Id<StructureContainer>;
  spot?: { x: number; y: number }; // mining position, recorded like a local source's
  // Copy of the source's own cached route (see ScoutedSource.route below), so the snapshot's remote
  // join only ever reads ColonyMemory and never reaches into Memory.rooms directly — same reasoning
  // that already justifies caching `distance` here instead of re-deriving it from the source's record.
  route?: RemoteRouteTile[];
}

// One tile of a cached home->remote-source path, tagged with the room it's in — a path can cross
// several rooms (home, transit, the remote room itself), and construction claims need to know which
// room each tile belongs to.
export interface RemoteRouteTile {
  room: string;
  x: number;
  y: number;
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
  // Real PathFinder path from a home room's anchor to this source, serialized (one direction digit per
  // tile, Traveler-style — see src/lib/remotePath.ts), keyed by that home room's name. Computed once, at
  // remote-selection time, and kept forever after: a source's position and a home's anchor never move,
  // so neither does the answer. Lives here (not ColonyMemory) because it's the *source*'s fact, not the
  // colony's — a second colony scouting the same room reuses nothing of a first colony's anchor-relative
  // path, but the cache still only ever needs one entry per home that has actually computed it.
  paths?: Partial<Record<string, string>>;
  // The same cached path as `paths`, as a room-tagged tile list instead of a direction-digit string —
  // the shape construction claims need (a claim must know which room a tile is in), computed at the same
  // time from the same PathFinder result so there's never a second path-finding call. Kept alongside
  // `paths` rather than replacing it, since nothing has ever needed to decode the digit string back into
  // positions (see remote-mining-progress/construction plan) and duplicating a small cache is cheaper
  // than risking that decode (cross-room direction math is exactly what broke scout-ping-pong before).
  route?: Partial<Record<string, RemoteRouteTile[]>>;
  // Negative cache: the tick a PathFinder search from this home last came back incomplete (no route —
  // e.g. terrain/vision blocks every crossing). Without this, a genuinely unreachable source has no way
  // to ever get marked "already tried" the way a successful search marks itself via `paths`/`route`, so
  // scouting/pathPrecompute would re-run the same failing PathFinder.search every tick forever. Bounded
  // backoff (see NO_PATH_RETRY_AFTER in lib/remotePath.ts) rather than permanent, so a route that opens
  // up later (new vision, a wall that was actually just unexplored terrain) is retried eventually.
  noPathAt?: Partial<Record<string, number>>;
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
  cpu?: Record<string, number>; // last tick's CPU per kernel system name, written by kernel/stats.ts
}

// A short window of (tick, total source energy) samples; harvest rate is diffed oldest-vs-newest. A ring rather than a
// running total so a gap in vision self-heals instead of poisoning the average forever.
export interface ColonyMetricsMemory {
  harvestSamples: { tick: number; sourceEnergy: number }[]; // oldest first, capped at HARVEST_WINDOW entries
}
