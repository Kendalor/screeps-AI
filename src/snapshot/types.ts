// Snapshot shapes handed to planners: plain data only, so planners can never touch Game.*.

export interface SnapUnit {
  id: Id<Creep>;
  x: number;
  y: number;
  hits: number;
  hitsMax: number;
  // This creep's live (hits > 0) HEAL parts, weighted by their LO/LHO2/XLHO2 boost multiplier (1x when
  // unboosted) and summed — e.g. 3 plain parts plus 2 XLHO2-boosted (4x) parts is 3 + 8 = 11. A boosted
  // healer's per-part output still depends on range at the point of use (HEAL_POWER at range <= 1,
  // RANGED_HEAL_POWER at range 2-3), so Defense's incomingHeal multiplies this by the range-appropriate
  // rate rather than a flat one — the weighting here only captures the boost, not the range.
  healParts: number;
  // Live ATTACK/RANGED_ATTACK parts, same boost-weighted-sum convention as healParts — combat.ts's
  // meleeAttackDamage/rangedAttackDamage multiply these by the range-appropriate power.
  attackParts: number;
  rangedAttackParts: number;
  // Blended TOUGH damage-reduction ratio: the average boost multiplier (0.7/0.5/0.3, GO/GHO2/XGHO2)
  // across this creep's live TOUGH parts, 1 (no reduction) when none are boosted or none exist. A flat
  // approximation of the engine's real per-part hit-pool walk (see combat.ts's effectiveIncomingDamage
  // header) — good enough for "is this fight worth taking", not a tick-exact hits simulation.
  toughReduction: number;
}

export interface SnapTower {
  id: Id<StructureTower>;
  x: number;
  y: number;
  storeEnergy: number;
  storeCapacity: number;
}

import type { XY } from "../lib/geometry";
import type { RemoteRouteTile, RoleName, ScoutInfo, SingleTargetOpState } from "../memory/schema";
import type { RoomType } from "../lib/roomName";

export interface SnapSpawn {
  id: Id<StructureSpawn>;
  busy: boolean; // spawning right now
}

// A single spawn or extension as an energy sink, with its own store so the logistics graph can hand a
// transport creep one specific structure to reserve (and thereby remove from other creeps' options),
// rather than only the colony-wide energyAvailable/energyCapacity aggregate. Spawns and extensions
// share a type here because a hauler fills them identically — the "any spawn/extension with room" pool.
export interface SnapSink extends XY {
  id: Id<StructureSpawn | StructureExtension>;
  storeEnergy: number;
  storeCapacity: number;
}

// One live creep, as a requester's satisfaction check sees it. No counts carried — different requesters project the same creeps differently.
export interface SnapCreep {
  id: Id<Creep>;
  name: string;
  body: BodyPartConstant[]; // live parts only (hits > 0)
  ticksToLive?: number; // undefined while spawning
  spawning: boolean;

  role: RoleName; // === memory.role
  home: string; // === memory.home
  room: string; // creep.pos.roomName — may differ from home (e.g. a scout on the frontier)
  x: number; // creep.pos.x — lets a planner range-gate a creep (e.g. only upgraders near the controller)
  y: number; // creep.pos.y

  hits: number; // current hit points — lets a planner tell a wounded creep from a healthy one (e.g. Drain's advance-only-when-healed gate)
  hitsMax: number;

  fatigue: number; // creep.fatigue — 0 unless standing on swamp/overweight; a fatigued creep's move() silently
  // no-ops this tick (no error, no signal beyond this field), so a squad's lockstep advance must gate on
  // every member reading 0 here, or a fatigued member falls behind while its squadmates still slide
  // forward — reintroducing per-member drift under a different mechanism than the independent-Traveler
  // convergence ADR 0007 replaced.

  storeEnergy: number; // current carried energy — lets a planner tell a loaded creep from an empty one
  storeCapacity: number; // total store capacity across all resource types

  // Live reference, deeply readonly: writing through it to Memory is a compile error, keeping Intent -> execute.ts the sole write boundary.
  memory: DeepReadonly<CreepMemory>;
}

// Compile-time-only deep readonly; no runtime Object.freeze.
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export interface SnapStructure extends XY {
  type: BuildableStructureConstant;
  // id/hits/hitsMax are present for a built structure, absent for a construction site (which has
  // neither hits nor a stable structure id yet). Lets the Building operation tell whether any built
  // structure has decayed far enough to be worth a repairer, and lets Defense target it with towerRepair.
  id?: Id<Structure>;
  hits?: number;
  hitsMax?: number;
}

export interface SnapContainer extends XY {
  id: Id<StructureContainer>;
  storeEnergy: number;
  storeCapacity: number;
}

// A built link, home room only (remote links aren't a thing this bot builds). `cooldown` is ticks
// until it can next send — a link mid-cooldown is a valid receiver but not a valid sender this tick.
export interface SnapLink extends XY {
  id: Id<StructureLink>;
  storeEnergy: number;
  storeCapacity: number;
  cooldown: number;
}

export interface SnapSource extends XY {
  id: Id<Source>;
  openTiles: number; // walkable tiles adjacent to the source, i.e. its miner/collector share cap
}

// This room's own mineral deposit, full per-tick fact (id, position, type, current amount,
// regeneration countdown, and — once built — extractor/container ids). extractorId/containerId are
// embedded at snapshot-construction time (a near-position scan), unlike source containers which are
// found by the reading operation — MineralMining wants a simpler read path since there's only one
// mineral per room to resolve.
export interface SnapMineral extends XY {
  id: Id<Mineral>;
  mineralType: MineralConstant;
  mineralAmount: number;
  ticksToRegeneration: number;
  extractorId?: Id<StructureExtractor>;
  containerId?: Id<StructureContainer>;
  // The container's own current mineral store, present only alongside containerId — SnapContainer's
  // storeEnergy is energy-specific and always reads 0 for this container, so its real (mineralType)
  // level is carried here instead, for operations/logistics.ts's transportPoolHasProvider gate.
  containerMineral?: number;
  containerCapacity?: number;
}

// A remote-room source selected for mining, in the *home* colony's snapshot. Local sources are
// conceptually these at distance 0, but stay in `sources` (SnapSource) to avoid churning every current
// reader — Mining iterates `sources` then `remoteSources`. x/y are in `room`'s coordinate space, not home's.
// Built by the snapshot builder from ColonyMemory.remotes joined against scout data + any live remote vision.
export interface SnapRemoteSource extends XY {
  id: Id<Source>;
  room: string; // the remote room this source lives in (never the home room)
  distance: number; // route length home storage/anchor -> source; drives haul-upkeep economics & nearest-first
  openTiles: number; // walkable tiles adjacent — miner/collector share cap (same meaning as SnapSource)
  containerId?: Id<StructureContainer>; // its drop container once built (in the remote room)
  reserved: boolean; // is the room currently reserved by us (10/tick) or not (5/tick)
  // Username currently holding the controller reservation, when it isn't us (e.g. "Invader" after a
  // STRUCTURE_INVADER_CORE reserves it). Undefined when unreserved or reserved by us — never re-derive
  // "is this foreign" elsewhere, this field is already filtered at the source (see remoteRoomVision).
  reservedBy?: string;
  // Username currently OWNING the controller (claimed, level 1+), when it isn't us. Distinct from
  // reservedBy (a claim, not a reservation) — see RemoteRoomVision.ownedBy's doc for why it's a separate
  // field. Undefined when unowned or owned by us.
  ownedBy?: string;
  danger: number; // hostile presence in the room; > 0 means stop staffing/reserving
  // The cached home->source path (see RemoteSourceMemory.route), room-tagged tile by tile. Absent until
  // resolveRemoteRoom has computed it at least once (e.g. selected but no anchor yet). Mining turns this
  // into container/road construction claims instead of re-deriving a path with a local-only cost-matrix
  // pather.
  route?: RemoteRouteTile[];
  // Straight copy of RemoteSourceMemory.routeBuilt (see its doc there) — which route[] tiles are already
  // confirmed built, index-aligned, surviving a vision gap in the tile's own room. building.ts's builtAt()
  // reads this for a remote-route road claim instead of (only) live colony.remoteStructures, which is
  // empty for a room the route merely transits through whenever nobody's standing in it right now.
  routeBuilt?: string;
}

export interface SnapDrop extends XY {
  id: Id<Resource>;
  amount: number;
}

// Energy sitting in a *remote* room, ready to be hauled home — the return-haul's provider set. A remote
// source's drop container or the ground pile a container-less remote miner drops into. Only present when
// we have vision of that room (a miner is standing in it). Additive: these are *extra* Logistics
// providers; home containers/drops are untouched. `decaying` marks a ground pile (rots) vs a container.
export interface SnapRemoteEnergy {
  id: Id<StructureContainer | Resource | Tombstone | Ruin>;
  room: string;
  amount: number;
  kind: "container" | "dropped" | "tombstone" | "ruin";
}

export interface SnapTombstone extends XY {
  id: Id<Tombstone>;
  storeEnergy: number;
}

// A destroyed structure's leftover energy — same decaying-pile treatment as a tombstone, just a
// different game object (FIND_RUINS instead of FIND_TOMBSTONES).
export interface SnapRuin extends XY {
  id: Id<Ruin>;
  storeEnergy: number;
}

// A room within scouting radius, as the Scouting operation sees it, built by walking the room graph at the snapshot boundary.
export interface ScoutCandidate {
  room: string;
  distance: number; // rooms from this colony (roomLinearDistance)
  type: RoomType;
  info?: ScoutInfo; // last recorded observation; absent means never scouted
}

// A room with vision this tick for any reason (owned, remote, a passing creep, a claimer) — not
// necessarily within scouting radius. Lets Scouting passively refresh sources/owner/tick on rooms no
// scout was ever dispatched to, without operations touching Game.rooms directly.
export interface VisibleRoom {
  room: string;
  info?: ScoutInfo; // last recorded observation; absent means never scouted
  // Live FIND_HOSTILE_CREEPS + hostile-owned-structure count this tick — unlike ScoutInfo.hostile
  // (controller ownership, cached and stale-tolerant), this is always fresh vision-gated truth for
  // whichever room this entry is for. Structures count too (not creeps alone): a room can hold nothing
  // but an invader core or another player's spawn/tower with zero live creeps in it, and that's still
  // not "clear". The one field Attack (operations/attack.ts) needs to tell "seen and clear" from "never
  // seen" or "seen and still hostile".
  hostileCount: number;
  // A STRUCTURE_INVADER_CORE's own `level` this tick, when one is standing in the room — 0 for the
  // plain remote-mining-room core (reserves the controller, easy to kill), 1-5 for a Stronghold's
  // fortified core (deploys defenders, surrounded by ramparts — not a target we can clear yet).
  // Undefined when no core is present. remoteInvaderAttacks.ts uses this to attack only level-0 cores.
  invaderCoreLevel?: number;
  // Whether this room's controller currently has safe mode active — hostiles present can't act (or be
  // acted on) at all, so Defense drops a sponsored target the moment this flips true rather than waiting
  // for hostileCount to reach 0 (it may never, since safe mode doesn't evict them).
  safeMode: boolean;
}

// What mining last recorded for a source, so an operation can tell a real change from rewriting the same values.
export interface SnapSourceMemory {
  spot?: XY;
  containerId?: Id<StructureContainer>;
  linkId?: Id<StructureLink>;
}

// What mineralMining last recorded about the deposit's regeneration, so it survives losing vision — see
// MineralMemory's own doc (memory/schema.ts) for why this needs to be cached rather than read live every
// tick. Absent means nothing recorded (never seen depleted, or last known state is "not regenerating").
export interface SnapMineralMemory {
  regeneratesAt?: number; // Game.time the deposit finishes regenerating
}

// Which built link plays which non-source role — mirrors sourceMemory's linkId, but for the two links
// Mining doesn't own. Absent fields mean that link hasn't been detected/recorded yet (e.g. controller
// still on a container pre-RCL5, or the anchor link not yet built).
export interface SnapLinkNetwork {
  storage?: Id<StructureLink>; // the anchor/storage link — see logistics/links.ts
  controller?: Id<StructureLink>; // owned by operations/upgrading.ts's controller container/link swap
}

export interface ColonySnapshot {
  name: string;
  tick: number; // mirrored Game.time, so operations can gate themselves to "is this my tick"
  towers: SnapTower[];
  hostiles: SnapUnit[];
  woundedFriendlies: SnapUnit[];
  safeModeAvailable: boolean;
  safeModeActive: number; // ticks remaining right now, 0 when inactive
  safeModeCount: number; // activations banked for later use
  creeps: SnapCreep[]; // alive + spawning creeps with memory.home this colony
  spawns: SnapSpawn[];
  // Per-structure spawn/extension sinks, so the logistics graph can reserve individual extensions for
  // one creep's multi-dropoff trip. energyAvailable/energyCapacity below remain the aggregate the fleet
  // sizing and spawn gating read — the two coexist, one for reservation, one for economy math.
  spawnSinks: SnapSink[];
  energyAvailable: number;
  energyCapacity: number;
  sources: SnapSource[];
  // This room's own mineral, if any — absent for a room with no mineral deposit. Read by
  // Colony.getMinerals(); today only an owned room's own mineral is ever mineable (a remote/keeper room's
  // mineral is scouting data only, see ScoutInfo.mineral, until keeper-room mining exists).
  mineral?: SnapMineral;
  remoteSources: SnapRemoteSource[]; // selected remote sources; empty until pickRemotes chooses some. Mining/Reservation/Logistics all read it.
  // Straight copy of ColonyMemory.remoteStrikes (see its doc there) — pure bookkeeping, not a live game
  // fact, so unlike remoteStructures/remoteDanger this needs no vision gating at all.
  remoteStrikes: Partial<Record<Id<Source>, number>>;
  remoteEnergy: SnapRemoteEnergy[]; // energy in remote rooms to haul home (the return-haul provider set); empty without remote vision
  drops: SnapDrop[]; // ground-level energy from drop mining
  tombstones: SnapTombstone[]; // energy left behind by a dead creep
  ruins: SnapRuin[]; // energy left behind by a destroyed structure
  terrain: Uint8Array; // 1 = walkable, 0 = wall, indexed [x*50+y]
  controller: XY; // controller position, so operations can path to it (e.g. the upgrade container)
  controllerLevel: number;
  controllerProgress: number;
  controllerProgressTotal: number; // progress needed to reach the next level; 0 at max RCL
  storageEnergy: number; // 0 when no storage built yet
  storageCapacity: number; // 0 when no storage built yet — total store capacity when it exists
  // How much of the room's own mineral type storage currently holds — 0 when no storage, no mineral, or
  // none stored yet. Needed alongside storageEnergy (not derivable from storageCapacity - storageEnergy,
  // which only accounts for the energy portion of a shared, multi-resource store) so
  // operations/logistics.ts's transportPoolHasConsumer/transportPoolHasProvider gates can compute
  // storage's real remaining mineral-agnostic free capacity instead of overcounting it by whatever
  // mineral is already stored.
  storageMineral: number;
  containers: SnapContainer[]; // empty until mining containers are built
  links: SnapLink[]; // every built link in the home room, source and anchor alike; empty until RCL5
  storageId?: Id<StructureStorage>; // absent until storage is built
  terminalId?: Id<StructureTerminal>; // absent until terminal is built
  terminalEnergy: number; // 0 when no terminal built yet
  terminalCapacity: number; // 0 when no terminal built yet
  anchor: XY | null; // null until a bunker-fitting anchor is found in this room
  sourceMemory: Partial<Record<Id<Source>, SnapSourceMemory>>; // keyed by source id; missing means nothing recorded yet
  mineralMemory: SnapMineralMemory; // last-recorded mineral regen state; see SnapMineralMemory's own doc
  linkNetwork: SnapLinkNetwork; // which built link is the anchor link vs the controller link; see SnapLinkNetwork
  // The planner's own "roads done" verdict (ColonyMemory.roadsBuilt, construction/planner.ts's
  // writeBuildingPlan) — true once energyCapacity has crossed the road-readiness gate AND no ROAD entry
  // in its own buildingPlan is still unbuilt. False before planBuilding has ever run once (colony's first
  // tick, or no anchor yet) — the same absent-means-not-yet-computed rule buildingPlan itself follows.
  // Consumed by spawn/bodyContext.ts instead of that module re-deriving road completion itself.
  roadsBuilt: boolean;
  structures: SnapStructure[];
  sites: SnapStructure[];
  // Built structures/sites in a *remote* room, keyed by room name — present only for a remote room with
  // vision this tick (a creep is standing in it), same live-or-nothing rule remoteEnergy/remote vision
  // already follow. Lets the construction arbiter dedup a remote claim against what's really there,
  // without ever needing a persistent "what's built in this room" cache — the room simply isn't visible
  // when there's nothing to dedup against.
  remoteStructures: Partial<Record<string, SnapStructure[]>>;
  remoteSites: Partial<Record<string, SnapStructure[]>>;
  // This tick's fresh danger read for a remote room, keyed by room name — present only with live vision,
  // same rule as remoteStructures/remoteSites. Mining diffs this against RemoteMemory.dangerUntil (via
  // colony.remoteSources) to know when to emit recordRemoteDanger; the resolved 0/1 SnapRemoteSource.danger
  // isn't enough for that since it's already blended with the memory fallback.
  remoteDanger: Partial<Record<string, number | undefined>>;
  // This tick's fresh reservation read for a remote room, keyed by room name — present only with live
  // vision, same rule as remoteDanger above. Mining reads this (not SnapRemoteSource.reservedBy, which
  // is already blended with the memory fallback) to know when to emit recordRemoteDanger's reservedBy.
  remoteReservedBy: Partial<Record<string, string | undefined>>;
  // Every construction site this colony currently owns across its own rooms (this colony's home room
  // plus its selected remote rooms), read from Game.constructionSites — vision-independent, unlike
  // remoteSites above, since a site's existence is known to its owner regardless of current visibility.
  // This is what the construction arbiter's shared budget counts against, so a site sitting in a remote
  // room with no vision this tick still consumes its share of the cap.
  siteSummary: { room: string; type: BuildableStructureConstant }[];
  constructionProgress: number; // total work remaining across all sites in the home room
  // Same, but for sites in this colony's selected remote rooms — vision-independent like siteSummary
  // (Game.constructionSites carries progress/progressTotal regardless of current room vision), so this
  // stays accurate even between the ticks a remote room has no creep standing in it.
  remoteConstructionProgress: number;
  scoutTargets: ScoutCandidate[]; // rooms within scouting radius; empty until the frontier is walked
  visibleRooms: VisibleRoom[]; // every room with vision this tick, regardless of scouting radius
  // Target rooms this colony is actively colonizing — durable equivalent of remoteSources' selection,
  // owned by colonize.ts (ColonyMemory.colonizing). Colony's constructor reads this directly to attach a
  // real Colonize operation per listed target, rather than deriving "is this colony colonizing X" from a
  // live colonizer/settler creep's own memory (see colony/index.ts's header for why that was fragile).
  colonizing: string[];
  // The combat equivalent of `colonizing` above, owned by attack.ts (ColonyMemory.attacking). Colony's
  // constructor reads this to attach a real Attack operation per listed target.
  attacking: string[];
  // Target rooms this colony sponsors a defender for beyond its own home/remotes (ColonyMemory.defending),
  // owned by defense.ts — Defense (already unconditionally attached, see operations/index.ts) pools these
  // alongside home/remote hostiles rather than gaining a second operation class, since it's the same
  // shared-defender-pool shape either way.
  defending: string[];
  // The drain equivalent of `attacking`, but a scalar (ColonyMemory.draining) rather than a list — see
  // ColonyMemory.draining's doc for why exactly one drain target per colony is load-bearing. Owned by
  // drain.ts; Colony's constructor attaches a real Drain operation while this is set.
  draining?: string;
  // Mirror of ColonyMemory.singleTargetOps — every SingleTargetFlagOperation-family entry (SimpleBaitTower,
  // Demolish, SimpleHeal, AttackController, ...), keyed by kind then target. Colony's constructor walks
  // this to attach one real operation instance per (kind, target) entry — the generalized replacement for
  // what used to be one scalar `simpleBaitTower?: string` (+ Flag/Wanted/SpawnedCount siblings) per kind;
  // see ColonyMemory.singleTargetOps's own doc for why it's keyed by target rather than a bare scalar.
  singleTargetOps: Partial<Record<string, Record<string, SingleTargetOpState>>>;
  // Room-by-room path from this colony's home room to `draining` (via Game.map.findRoute), each tagged
  // with its cached ScoutInfo.hostile (false when the room has never been scouted) — the input Drain's
  // pure staging-room picker walks. Empty whenever `draining` is unset; computed once here (the snapshot
  // boundary) so Drain itself never needs Game.map, matching every other operation's ColonySnapshot-only
  // contract (see operations/operation.ts's header).
  drainRoute: { room: string; hostile: boolean }[];
  // Every hostile-owned tower with vision this tick, keyed by room name — populated empire-wide (like
  // visibleRooms) rather than joined through the remote-mining vision pipeline (remoteStructures), since
  // that join is scoped to this colony's own selected remote rooms and would never see a hostile drain
  // target. Absent/empty for a room with no vision this tick, same vision-gated convention every other
  // live-read field here follows. Drain's advance/retreat check reads this for its current target room.
  hostileRoomTowers: Partial<Record<string, SnapTower[]>>;
  // Every hostile creep with vision this tick, keyed by room name — the target-room equivalent of the
  // home-room-only `hostiles` field above, populated empire-wide/vision-gated exactly like
  // hostileRoomTowers (any room with vision, not scoped to `draining`). `hostiles` alone cannot serve a
  // squad fighting AWAY from home (e.g. Drain's target room), which is the gap this closes — a formation
  // deciding which way to face needs the melee/ranged composition (SnapUnit.attackParts/rangedAttackParts)
  // of whatever it's actually fighting, not of hostiles back in its own room. Absent/empty for a room with
  // no vision this tick, same convention as hostileRoomTowers.
  hostileRoomUnits: Partial<Record<string, SnapUnit[]>>;
  // Every road standing in a visible room, keyed by room name — same empire-wide/vision-gated population
  // as hostileRoomTowers (any room with vision this tick), but roads rather than hostile towers. Exists
  // for a remote route's TRANSIT rooms specifically: remoteStructures is only ever populated for a
  // selected source's own room (see remoteRoomVision), so a room the route merely passes through (never
  // mined itself) has no live structure data anywhere else in the snapshot. Mining.intents() reads this
  // to confirm a route tile is actually built (see RemoteSourceMemory.routeBuilt's doc) even for a
  // transit room. Absent/empty for a room with no vision this tick or no roads.
  visibleRoomRoads: Partial<Record<string, XY[]>>;
  // A visible room's storage energy, keyed by room name — the storage-content equivalent of
  // hostileRoomTowers above, same empire-wide/vision-gated population (any room with vision this tick,
  // not scoped to this colony's own remotes). Absent for a room with no vision OR no storage structure —
  // the two are indistinguishable here, same as hostileRoomTowers being absent for "no vision" and
  // "no towers" alike; a room known (via prior observation) to have a storage just isn't sampled that
  // tick. Drain's snapshot-history recorder (#40/ADR 0006) reads this for its current target room.
  hostileRoomStorageEnergy: Partial<Record<string, number>>;
  // Terrain for `draining` and its staging room only (not vision-gated like hostileRoomTowers/
  // hostileRoomStorageEnergy above — Room.Terrain reads static map data for ANY room, visible or not, so
  // there's nothing to gate). Same 1=walkable/0=wall, [x*50+y]-indexed convention as the home room's own
  // `terrain` field. Drain's formation math must never place a squad member on a wall tile — confirmed
  // live on shard0 (2026-08-05): a follower's assigned 2x2 slot landed on a wall, so it could never
  // physically reach it, holding the whole squad in place forever (the inFormation gate correctly held
  // the leader, but nothing had reason to expect the block itself to be unreachable in the first place).
  drainRoomTerrain: Partial<Record<string, Uint8Array>>;
  // Live OCCUPANCY for `draining` and its route rooms — 1=a live creep (hostile OR our own bystander, e.g.
  // a frozen Defender from an unrelated operation) or an obstructing structure currently stands on that
  // tile, 0=clear, same [x*50+y] indexing as drainRoomTerrain. UNLIKE drainRoomTerrain this genuinely
  // NEEDS vision — a bystander's position is a live fact, not static map data — so a room with no vision
  // this tick has NO entry here at all (fails open to "nothing occupied," the same convention every other
  // vision-gated field in this snapshot already follows, e.g. hostileRoomTowers). Recomputed fresh every
  // tick, never persisted across a vision gap: an occupant that walked away between the last-seen tick and
  // now must not still read as blocking, and squad pathing already fails open safely on missing data (see
  // OccupancySource's doc, lib/squadPath.ts) so there is nothing to gain from staleness here. Feeds
  // planSquadMove/nearestFittingAnchor so a squad routes around a bystander creep or structure exactly as
  // it would a wall, closing the gap flagged in docs/drain-squad-handoff.md's open issue #2.
  drainRoomOccupancy: Partial<Record<string, Uint8Array>>;
  // The parade equivalent of `draining` above (ColonyMemory.parading), but the whole record rather than
  // just a room name: Parade needs the formation shape too, and — unlike a drain target room, which is
  // fixed at handoff time — has no target ROOM concept at all (see paradeGoal below for the live position
  // that actually drives it). Owned by parade.ts; Colony's constructor attaches a real Parade operation
  // while this is set.
  parading?: { flag: string; formation: string };
  // The parade flag's CURRENT position, read fresh from Game.flags every tick at the snapshot boundary
  // (the one place Game.flags is touched outside empire/*Flags.ts — see paradeFlags.ts's header for why a
  // flag's presence/position must be re-read live rather than cached: unlike draining's fixed target room,
  // Parade's whole point is that the player can drag the flag and the squad follows). Undefined when
  // `parading` is set but the named flag itself has been removed (paradeFlags.ts hasn't cleared it yet, a
  // one-tick race) — Parade simply holds the squad in place until either the flag reappears or the next
  // tick's paradeFlags pass clears `parading` outright.
  paradeGoal?: XY & { room: string };
  // Terrain for every room Parade might place a squad member in, same not-vision-gated convention as
  // drainRoomTerrain (Game.map.getRoomTerrain reads static data for any room, seen or not) — just the
  // flag's own current room and the colony's home room, since a parade (unlike a drain squad walking a
  // precomputed route toward a fixed hostile target) has no route to precompute: the flag can jump to any
  // room the player drags it to, so only "where the squad's anchor is now" and "where the goal is now"
  // are ever actually pathed between in a single tick, and PathFinder resolves whatever lies between them.
  paradeRoomTerrain: Partial<Record<string, Uint8Array>>;
  // Live occupancy for the same rooms as paradeRoomTerrain, same vision-gated convention as
  // drainRoomOccupancy (a room with no vision this tick has no entry, failing open to "nothing occupied").
  paradeRoomOccupancy: Partial<Record<string, Uint8Array>>;
  // The drain/parade squad's persisted anchor (ColonyMemory.drainAnchor/paradeAnchor) — a straight
  // pass-through read, same pattern as `draining`/`parading` themselves. See lib/squad.ts's SquadState doc
  // and ColonyMemory.drainAnchor's doc for why this exists: the anchor is a colony-owned value the owning
  // operation's own route advances, not something re-derived from a live creep's position every tick.
  drainAnchor?: XY & { room: string };
  paradeAnchor?: XY & { room: string };
}

export interface EmpireSnapshot {
  tick: number;
  colonies: ColonySnapshot[];
}
