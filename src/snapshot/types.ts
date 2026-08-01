// Snapshot shapes handed to planners: plain data only, so planners can never touch Game.*.

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
  storeEnergy: number;
  storeCapacity: number;
}

import type { XY } from "../lib/geometry";
import type { RemoteRouteTile, RoleName, ScoutInfo } from "../memory/schema";
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
  danger: number; // hostile presence in the room; > 0 means stop staffing/reserving
  // The cached home->source path (see RemoteSourceMemory.route), room-tagged tile by tile. Absent until
  // resolveRemoteRoom has computed it at least once (e.g. selected but no anchor yet). Mining turns this
  // into container/road construction claims instead of re-deriving a path with the local-only cost-matrix
  // pather in layouts/roads.ts.
  route?: RemoteRouteTile[];
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
  id: Id<StructureContainer | Resource | Tombstone>;
  room: string;
  amount: number;
  kind: "container" | "dropped" | "tombstone";
}

export interface SnapTombstone extends XY {
  id: Id<Tombstone>;
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
}

// What mining last recorded for a source, so an operation can tell a real change from rewriting the same values.
export interface SnapSourceMemory {
  spot?: XY;
  containerId?: Id<StructureContainer>;
  linkId?: Id<StructureLink>;
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
  mineral?: MineralConstant;
  remoteSources: SnapRemoteSource[]; // selected remote sources; empty until pickRemotes chooses some. Mining/Reservation/Logistics all read it.
  remoteEnergy: SnapRemoteEnergy[]; // energy in remote rooms to haul home (the return-haul provider set); empty without remote vision
  drops: SnapDrop[]; // ground-level energy from drop mining
  tombstones: SnapTombstone[]; // energy left behind by a dead creep
  terrain: Uint8Array; // 1 = walkable, 0 = wall, indexed [x*50+y]
  controller: XY; // controller position, so operations can path to it (e.g. the upgrade container)
  controllerLevel: number;
  controllerProgress: number;
  controllerProgressTotal: number; // progress needed to reach the next level; 0 at max RCL
  storageEnergy: number; // 0 when no storage built yet
  storageCapacity: number; // 0 when no storage built yet — total store capacity when it exists
  containers: SnapContainer[]; // empty until mining containers are built
  links: SnapLink[]; // every built link in the home room, source and anchor alike; empty until RCL5
  storageId?: Id<StructureStorage>; // absent until storage is built
  terminalId?: Id<StructureTerminal>; // absent until terminal is built
  terminalEnergy: number; // 0 when no terminal built yet
  terminalCapacity: number; // 0 when no terminal built yet
  anchor: XY | null; // null until a bunker-fitting anchor is found in this room
  sourceMemory: Partial<Record<Id<Source>, SnapSourceMemory>>; // keyed by source id; missing means nothing recorded yet
  linkNetwork: SnapLinkNetwork; // which built link is the anchor link vs the controller link; see SnapLinkNetwork
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
}

export interface EmpireSnapshot {
  tick: number;
  colonies: ColonySnapshot[];
}
