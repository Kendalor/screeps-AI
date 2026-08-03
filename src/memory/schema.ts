// ALL memory interfaces. Each field is owned by exactly one system; others read it via the snapshot, never write it.

import type { RoomType } from "../lib/roomName";
import type { TaskState } from "../behaviors/types";
import type { LogisticsTask } from "../logistics/types";
import type { LogLevel } from "../lib/log";
import type { XY } from "../lib/geometry";
import type { Reputation } from "./reputation";

declare global {
  interface Memory {
    version: number;
    colonies: Record<string, ColonyMemory>;
    scouting: ScoutingMemory;
    expansion: ExpansionMemory;
    stats: StatsMemory;
    metrics: Record<string, ColonyMetricsMemory>; // cross-tick harvest-rate window; everything else in a report is derived fresh
    // Console-editable player reputation (Memory.playerReputation["Foo"] = "hostile"), also written
    // automatically when we observe a player's creep attack us — see memory/reputation.ts's
    // recordHostileAction. Absent entries default to "neutral" (reputationOf), never assumed hostile.
    playerReputation?: Record<string, Reputation>;
    logLevel?: LogLevel; // set via the in-game console (commands/console.ts); absent means "error" only
    debugMetrics?: boolean; // set via the in-game console (commands/console.ts); toggles the right-aligned debug panel
    // Creep names / colony room names currently opted into log.debugCreep/log.debugRoom tracing (see
    // lib/log.ts), set via the in-game console's debugCreep/debugColony commands. Independent of logLevel:
    // a debug call only ever prints for a tag listed here, no matter the global level. Absent means no
    // tracing anywhere — the common case, so a fresh Memory need not initialize these to `[]`.
    debugCreeps?: string[];
    debugColonies?: string[];
    // Disables pickRemotes selection empire-wide (mining/pickRemotes.ts) — set via the in-game console
    // or (today) directly by an integration test's patchMemory, to isolate a scenario's spawn economics
    // from a competing remote-mining fleet without faking scout data/terrain to avoid it being
    // discovered. Absent/false means remote mining runs normally. A real per-colony configuration system
    // is a nice-to-have for later; this single empire-wide flag is deliberately the minimal version.
    debugDisableRemoteMining?: boolean;
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
    // The attacker equivalent of defendTargetRoom: which room this attacker is currently sent to clear,
    // owned by operations/attack.ts. Same reassignment rule as defendTargetRoom — one Attack operation
    // per colony pools every queued target (ColonyMemory.attacking) and reassigns its one attacker to the
    // next open target once its current one clears, so a surviving attacker carries over between rooms
    // instead of a fresh one spawning per target.
    attackTargetRoom?: string;
    lastRoom?: string; // room a scout was standing in when last (re)assigned; avoided by the next pick unless it's the only option
    route?: RouteMemory; // precomputed room-by-room route for long-haul movement, walked by moveToRoom
    // Last non-OK return code a colonizer's claimController call hit, owned by behaviors/interpreter.ts's
    // claimStep alone. Purely diagnostic/logging (the log line fires once per distinct code) — NOT what
    // Colonize's claimFailedPermanently reads to decide the target is unwinnable; see claimOwnedByOther
    // below for that. Set the first time a given code is seen; cleared back to undefined the tick it's
    // absent (i.e. the claim finally landed), so a stale code from a past failure can't be misread as
    // current. Typed to claimController's own return union, not the broader ScreepsReturnCode — it
    // includes ERR_ACCESS_DENIED (a shard-access gate), which isn't part of that general union.
    claimError?: CreepActionReturnCode | ERR_FULL | ERR_GCL_NOT_ENOUGH | ERR_ACCESS_DENIED;
    // True once claimStep has seen the target controller genuinely owned by another player
    // (controller.owner !== undefined) — the ONE unrecoverable claim failure. Deliberately separate from
    // claimError: the engine's ERR_INVALID_TARGET is ambiguous, covering both "owned by someone" (this,
    // terminal) and "reserved by someone" (attackController fights this down over time — a colonizer can
    // die mid-fight and a fresh one picks up where the reservation level left off, never terminal on its
    // own). Colonize's claimFailedPermanently reads this flag alone, not claimError, so a contested-but-
    // winnable reservation fight never silently tears the operation down.
    claimOwnedByOther?: boolean;
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
  | "colonizer"
  | "settler"
  | "pioneer"
  | "defender"
  | "attacker";

export interface ColonyMemory {
  anchor?: { x: number; y: number }; // owned by building
  sources: Record<Id<Source>, SourceMemory>; // owned by mining
  links?: LinkNetworkMemory; // owned by links
  remotes: RemoteMemory[]; // the selected remote rooms + their mined sources; owned by mining (pickRemotes writes it)
  danger: number; // owned by defense
  // Target rooms this colony is actively colonizing (sponsoring a colonizer/settler for), owned by
  // colonize.ts. Written once when a flag/auto-pick resolves this colony as the sponsor
  // (addColonizeTarget), read every tick by Colony's constructor to attach a real Colonize operation per
  // listed target — the durable equivalent of `remotes` above, so the operation's existence is a plain
  // memory fact rather than derived indirectly from a live colonizer/settler creep's own memory (the
  // latter was fragile: nothing observed it until a creep already existed, so the handoff from "flag
  // resolved" to "operation attached" had a real gap). Removed (removeColonizeTarget) once the target's
  // job is done (reached SELF_SUFFICIENT_ENERGY_CAP) or permanently failed (terminal claimController
  // error) — see colonize.ts's own removal logic.
  colonizing: string[];
  // Target rooms this colony is actively attacking (sponsoring an attacker for), owned by attack.ts —
  // the combat equivalent of `colonizing` above, same durable-memory-fact shape: written once by a flag
  // handoff (addAttackTarget), read every tick by Colony's constructor to attach a real Attack operation
  // per listed target, removed (removeAttackTarget) once that room has vision and no hostile creeps left.
  attacking: string[];
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
  // Username currently holding the controller reservation, when it isn't us — e.g. "Invader" after a
  // STRUCTURE_INVADER_CORE reserves it, or another player. Absent means unreserved OR reserved by us
  // (see remoteRoomVision's `reserved` field for that case); never our own username. Unlike dangerUntil,
  // a reservation doesn't decay on its own — this persists across vision loss until the room is next
  // seen with no foreign reservation.
  reservedBy?: string;
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
  owner?: string; // controller owner's/reserver's username, including the "Invader" NPC
  // Owned or reserved by another real player (not us, not the Invader NPC) — see execute.ts's
  // observeRoom for the exact derivation. An Invader-core reservation leaves this false: that's treated
  // as temporary/contestable (remoteInvaderAttacks.ts), not a permanent avoid signal like a player claim.
  hostile: boolean;
  // Best bunker anchor for this room, if one fits (see layouts/stamp.ts) — normal rooms with a
  // controller only. Computed once from terrain+controller+sources, which never change, and kept
  // forever after like `sources`/`mineral`. The headline input for expansion: a room with no anchor
  // can never be colonized.
  anchor?: XY;
  // Whether resolveScoutedAnchor has actually run for this room (true even when it found no fit).
  // Without this, `anchor === undefined` is ambiguous between "no controller, never attempted" and
  // "has a controller, terrain rejected every candidate" — a colonization picker needs to tell those
  // apart (the latter is a real, permanent "no" for this room; the former just means check `type`
  // instead). Absent/false on any record from before this field existed.
  anchorChecked?: boolean;
  // Pure map-topology colonization score for this room as a potential anchor: the summed
  // remotePotential/keeperPotential (see mining/remotePotentialTable.ts, mining/keeperPotentialTable.ts)
  // of every room within MAX_REMOTE_HOPS, split by normal-vs-keeper since keeper-room mining isn't a
  // built capability yet (see keeperPotential's own upkeep — this is reported, not folded into a single
  // number, so an unbuilt capability can't silently dominate a decision made today). Deliberately does
  // NOT factor in any neighbor's current owner/hostile/reservation state — those change over time and are
  // evaluated separately, live, at actual selection time; this field answers only "how good is this
  // room's permanent map position," which — like `anchor` — never changes once computed, so it's
  // computed once and cached forever. Requires every room within range to already have its own ScoutInfo
  // (source counts, room type) on record — see `potentialChecked` for whether that precondition has been
  // met yet.
  potential?: ColonizationPotential;
  // Whether resolvePotential has actually run for this room (true even if every neighbor scored 0).
  // Unlike anchorChecked, this can't always be computed the moment a room is first scouted — it needs
  // every room within MAX_REMOTE_HOPS to already carry its own ScoutInfo, and the scouting frontier grows
  // outward gradually, so a neighbor may simply not be scouted yet. False/absent means "not attempted,
  // OR attempted but the neighborhood wasn't fully scouted yet" — retried on a later scouting pass either
  // way, same as anchorChecked distinguishes "never attempted" from "attempted, no fit" for anchor.
  potentialChecked?: boolean;
  // Negative cache: the tick a scout last failed to path into this room from `home` (Traveler's travelTo
  // came back ERR_NO_PATH — a real PathFinder search with the scout's own vision at the border, not a
  // findRoute/describeExits guess; see remotePath.ts's ScoutedSource.noPathAt for the same pattern applied
  // to source paths). Game.map.findRoute has no concept of constructed walls at all, so a room can be
  // graph-reachable and zone-status-eligible (scoutCandidatesAround already filters the respawn/novice
  // case) yet still be 100% walled off by another player at every shared border. This does NOT exclude the
  // room from scoutTargets/candidate picking — a scout can always reach the exit tile itself (structures
  // can never occupy one, see remotePath.ts's isExitTile) and observes the room fine from there, fulfilling
  // the scouting order even if it can never walk further in. It only marks the room too expensive to use as
  // a transit hop for OTHER routes (see execute.ts's dangerRouteCost), so a real border wall can't keep
  // getting rediscovered by every route that happens to cross it.
  noPathFrom?: Partial<Record<string, number>>;
}

// The two topology-only colonization numbers for one room, plus the extra keeper minerals reachable if
// keeper-room mining existed. See ScoutInfo.potential's doc for what these do and don't account for.
export interface ColonizationPotential {
  normal: number; // avg net energy/tick from unowned normal-room neighbors within MAX_REMOTE_HOPS
  keeper: number; // same, from keeper-room neighbors — informational only; keeper mining isn't built yet
  keeperMinerals: MineralConstant[]; // distinct minerals available across those keeper-room neighbors
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
