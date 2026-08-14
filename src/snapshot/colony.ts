// Builds snapshots from Game state — the only place planners' input touches the live API.

import { openHarvestTiles } from "../behaviors/targets";
import { findAnchorCandidates, pickAnchor, walkablePixelsForRoom } from "../construction/stamp";
import { ATTACK_BOOST_MULTIPLIER, HEAL_BOOST_MULTIPLIER, RANGED_ATTACK_BOOST_MULTIPLIER, TOUGH_BOOST_MULTIPLIER } from "../lib/combat";
import type { XY } from "../lib/geometry";
import { wrapFn } from "../lib/profiler";
import { buildRemoteSources, type RemoteRoomVision } from "../mining/remoteSources";
import { censusByColony } from "./census";
import { scoutCandidatesAround } from "./scoutGraph";
import type {
  ColonySnapshot,
  EmpireSnapshot,
  SnapCreep,
  SnapRemoteEnergy,
  SnapStructure,
  SnapTower,
  SnapUnit,
  VisibleRoom
} from "./types";

export const buildEmpireSnapshot = wrapFn(function buildEmpireSnapshot(): EmpireSnapshot {
  // One pass over all creeps -> grouped by home colony.
  const byColony = censusByColony(Object.values(Game.creeps).map(snapCreep));
  // Every room-scoped, vision-gated field below (visibleRooms, hostileRoomTowers, hostileRoomUnits,
  // hostileRoomStorageEnergy, visibleRoomRoads) used to be its own separate `for (const name in
  // Game.rooms)` loop, each re-running its own room.find(...) — up to 3 FIND_HOSTILE_STRUCTURES/
  // FIND_HOSTILE_CREEPS/FIND_STRUCTURES calls per visible room per tick for no new information, since
  // every one of these fields is keyed off the exact same room set. Merged into one pass: each room's
  // hostile structures/creeps/structures are fetched once and reused across all five fields. Confirmed
  // live (2026-08-13 CPU profiling) this was a real, if secondary, empire-wide cost — scales with every
  // visible room (owned + remotes + scout transit), not just owned colonies.
  const visibleRooms: VisibleRoom[] = [];
  const hostileRoomTowers: Partial<Record<string, SnapTower[]>> = {};
  const hostileRoomUnits: Partial<Record<string, SnapUnit[]>> = {};
  const hostileRoomStorageEnergy: Partial<Record<string, number>> = {};
  const visibleRoomRoads: Partial<Record<string, XY[]>> = {};
  for (const name in Game.rooms) {
    const r = Game.rooms[name];
    const hostileStructures = r.find(FIND_HOSTILE_STRUCTURES);
    const hostileCreeps = r.find(FIND_HOSTILE_CREEPS);
    const invaderCore = hostileStructures.find((s): s is StructureInvaderCore => s.structureType === STRUCTURE_INVADER_CORE);
    visibleRooms.push({
      room: name,
      info: Memory.rooms?.[name]?.scouted,
      hostileCount: hostileCreeps.length + hostileStructures.length,
      ...(invaderCore ? { invaderCoreLevel: invaderCore.level } : {})
    });

    // Empire-wide/vision-gated, same "any room's vision is empire-wide" reasoning throughout: whichever
    // colony's Drain operation (or squad) is currently targeting/passing through this room (or not — all
    // of these are unconditional on any colony's `draining`/`attacking`/`colonizing`) gets to read it.
    const towers = hostileStructures
      .filter((s): s is StructureTower => s.structureType === STRUCTURE_TOWER)
      .map(t => ({
        id: t.id,
        x: t.pos.x,
        y: t.pos.y,
        storeEnergy: t.store.getUsedCapacity(RESOURCE_ENERGY),
        storeCapacity: t.store.getCapacity(RESOURCE_ENERGY)
      }));
    if (towers.length > 0) hostileRoomTowers[name] = towers;

    // The target-room composition data a squad needs to face/react to threats it's actually fighting
    // (ColonySnapshot.hostileRoomUnits' doc). Reuses snapUnit so a hostile's boosted parts read the same
    // way an ally's do.
    const units = hostileCreeps.map(snapUnit);
    if (units.length > 0) hostileRoomUnits[name] = units;

    // The room's storage contents — Drain's snapshot history (#40) samples both this and towers above.
    // Only rooms with vision AND an actual storage structure get an entry (undefined for either).
    const storage = r.storage;
    if (storage) hostileRoomStorageEnergy[name] = storage.store.getUsedCapacity(RESOURCE_ENERGY);

    // Every ROAD in the room — see ColonySnapshot.visibleRoomRoads' doc for why this exists (a remote
    // route's transit rooms have no other live structure data anywhere in the snapshot).
    const roads = r
      .find(FIND_STRUCTURES)
      .filter((s): s is StructureRoad => s.structureType === STRUCTURE_ROAD)
      .map(road => ({ x: road.pos.x, y: road.pos.y }));
    if (roads.length > 0) visibleRoomRoads[name] = roads;
  }

  const colonies: ColonySnapshot[] = [];
  for (const name in Game.rooms) {
    const room = Game.rooms[name];
    if (!room.controller?.my) continue;
    colonies.push(
      buildColonySnapshot(
        room,
        byColony[name] ?? [],
        Game.time,
        visibleRooms,
        hostileRoomTowers,
        hostileRoomUnits,
        hostileRoomStorageEnergy,
        visibleRoomRoads
      )
    );
  }
  return { tick: Game.time, colonies };
}, "planning:buildEmpireSnapshot");

// Body is filtered to living parts: a part at 0 hits harvests nothing and must not be counted.
function snapCreep(c: Creep): SnapCreep {
  return {
    id: c.id,
    name: c.name,
    body: c.body.filter(p => p.hits > 0).map(p => p.type),
    ticksToLive: c.ticksToLive,
    spawning: c.spawning,
    role: c.memory.role,
    home: c.memory.home,
    room: c.pos.roomName,
    x: c.pos.x,
    y: c.pos.y,
    hits: c.hits,
    hitsMax: c.hitsMax,
    fatigue: c.fatigue,
    storeEnergy: c.store.getUsedCapacity(RESOURCE_ENERGY),
    storeCapacity: c.store.getCapacity(),
    memory: c.memory
  };
}

function buildColonySnapshot(
  room: Room,
  creeps: SnapCreep[],
  tick: number,
  visibleRooms: VisibleRoom[],
  hostileRoomTowers: Partial<Record<string, SnapTower[]>>,
  hostileRoomUnits: Partial<Record<string, SnapUnit[]>>,
  hostileRoomStorageEnergy: Partial<Record<string, number>>,
  visibleRoomRoads: Partial<Record<string, XY[]>>
): ColonySnapshot {
  const controller = room.controller!;
  const myCreeps = room.find(FIND_MY_CREEPS);
  const remotes = Memory.colonies[room.name]?.remotes ?? [];
  const colonizing = Memory.colonies[room.name]?.colonizing ?? [];
  const attacking = Memory.colonies[room.name]?.attacking ?? [];
  const defending = Memory.colonies[room.name]?.defending ?? [];
  const draining = Memory.colonies[room.name]?.draining;
  const drainRoute = draining ? drainRouteTo(room.name, draining) : [];
  const parading = Memory.colonies[room.name]?.parading;
  const paradeGoal = parading ? paradeGoalFor(parading.flag) : undefined;
  const paradeRooms = new Set([room.name, ...(paradeGoal ? [paradeGoal.room] : [])]);
  const vision = remoteRoomVision(remotes, controller.owner?.username);
  const remoteStructures: Partial<Record<string, SnapStructure[]>> = {};
  const remoteSites: Partial<Record<string, SnapStructure[]>> = {};
  const remoteDanger: Partial<Record<string, number | undefined>> = {};
  const remoteReservedBy: Partial<Record<string, string | undefined>> = {};
  for (const [roomName, live] of Object.entries(vision)) {
    if (!live) continue;
    remoteStructures[roomName] = live.structures;
    remoteSites[roomName] = live.sites;
    remoteDanger[roomName] = live.dangerUntil;
    remoteReservedBy[roomName] = live.reservedBy;
  }
  // Vision-independent: an owned site exists regardless of whether we currently see the room it's in,
  // so the shared construction budget (construction/planner.ts) can count a remote site even between the
  // ticks a creep gives it vision. Scoped to this colony's own rooms — Game.constructionSites is
  // empire-wide across every colony the player owns.
  const ownRooms = ownRoomsFor(room.name, remotes);
  const ownSites = Object.values(Game.constructionSites).filter(s => ownRooms.has(s.pos.roomName));
  const siteSummary = ownSites.map(s => ({ room: s.pos.roomName, type: s.structureType }));
  return {
    name: room.name,
    tick,
    towers: room
      .find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER })
      .map(t => ({
        id: t.id as Id<StructureTower>,
        x: t.pos.x,
        y: t.pos.y,
        storeEnergy: (t as StructureTower).store.getUsedCapacity(RESOURCE_ENERGY),
        storeCapacity: (t as StructureTower).store.getCapacity(RESOURCE_ENERGY)
      })),
    hostiles: room.find(FIND_HOSTILE_CREEPS).map(snapUnit),
    woundedFriendlies: myCreeps.filter(c => c.hits < c.hitsMax).map(snapUnit),
    safeModeAvailable:
      controller.safeModeAvailable > 0 && !controller.safeMode && !controller.safeModeCooldown,
    safeModeActive: controller.safeMode ?? 0,
    safeModeCount: controller.safeModeAvailable,
    creeps,
    spawns: room
      .find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN })
      .map(s => ({ id: s.id as Id<StructureSpawn>, busy: (s as StructureSpawn).spawning !== null })),
    spawnSinks: room
      .find<StructureSpawn | StructureExtension>(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION
      })
      .map(s => ({
        id: s.id,
        x: s.pos.x,
        y: s.pos.y,
        storeEnergy: s.store.getUsedCapacity(RESOURCE_ENERGY),
        storeCapacity: s.store.getCapacity(RESOURCE_ENERGY)
      })),
    energyAvailable: room.energyAvailable,
    energyCapacity: room.energyCapacityAvailable,
    sources: room.find(FIND_SOURCES).map(s => ({ id: s.id, x: s.pos.x, y: s.pos.y, openTiles: openHarvestTiles(s) })),
    mineral: room.find(FIND_MINERALS)[0]?.mineralType,
    remoteSources: buildRemoteSources(remotes, vision, tick),
    remoteStrikes: Memory.colonies[room.name]?.remoteStrikes ?? {},
    remoteEnergy: remoteEnergyFor(remotes),
    drops: room.find(FIND_DROPPED_RESOURCES).map(d => ({ id: d.id, x: d.pos.x, y: d.pos.y, amount: d.amount })),
    tombstones: room
      .find(FIND_TOMBSTONES)
      .map(t => ({ id: t.id, x: t.pos.x, y: t.pos.y, storeEnergy: t.store.getUsedCapacity(RESOURCE_ENERGY) })),
    ruins: room
      .find(FIND_RUINS)
      .map(r => ({ id: r.id, x: r.pos.x, y: r.pos.y, storeEnergy: r.store.getUsedCapacity(RESOURCE_ENERGY) })),
    terrain: walkablePixelsForRoom(room.name),
    controller: { x: controller.pos.x, y: controller.pos.y },
    controllerLevel: controller.level,
    controllerProgress: controller.progress,
    controllerProgressTotal: controller.progressTotal ?? 0, // undefined at RCL8 (max)
    storageEnergy: room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    storageCapacity: room.storage?.store.getCapacity(RESOURCE_ENERGY) ?? 0,
    storageId: room.storage?.id,
    containers: room
      .find<StructureContainer>(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_CONTAINER
      })
      .map(c => ({
        id: c.id,
        x: c.pos.x,
        y: c.pos.y,
        storeEnergy: c.store.getUsedCapacity(RESOURCE_ENERGY),
        storeCapacity: c.store.getCapacity()
      })),
    links: room
      .find<StructureLink>(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_LINK })
      .map(l => ({
        id: l.id,
        x: l.pos.x,
        y: l.pos.y,
        storeEnergy: l.store.getUsedCapacity(RESOURCE_ENERGY),
        storeCapacity: l.store.getCapacity(RESOURCE_ENERGY),
        cooldown: l.cooldown
      })),
    terminalId: room.terminal?.id,
    terminalEnergy: room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
    terminalCapacity: room.terminal?.store.getCapacity(RESOURCE_ENERGY) ?? 0,
    anchor: resolveAnchor(room),
    sourceMemory: Memory.colonies[room.name]?.sources ?? {},
    linkNetwork: Memory.colonies[room.name]?.links ?? {},
    structures: room
      .find(FIND_STRUCTURES)
      .filter((s): s is AnyStructure & { structureType: BuildableStructureConstant } => s.structureType !== STRUCTURE_CONTROLLER)
      .map(snapStructure),
    sites: room.find(FIND_MY_CONSTRUCTION_SITES).map(snapStructure),
    remoteStructures,
    remoteSites,
    remoteDanger,
    remoteReservedBy,
    siteSummary,
    constructionProgress: ownSites
      .filter(s => s.pos.roomName === room.name)
      .reduce((remaining, site) => remaining + (site.progressTotal - site.progress), 0),
    remoteConstructionProgress: ownSites
      .filter(s => s.pos.roomName !== room.name)
      .reduce((remaining, site) => remaining + (site.progressTotal - site.progress), 0),
    // Rooms within the current scouting radius; radius grows as the frontier is exhausted.
    scoutTargets: scoutCandidatesAround(room.name, Memory.scouting?.radius ?? 1, room.name),
    visibleRooms,
    colonizing,
    attacking,
    defending,
    draining,
    drainRoute,
    hostileRoomTowers,
    hostileRoomUnits,
    hostileRoomStorageEnergy,
    visibleRoomRoads,
    drainRoomTerrain: drainTerrainFor(room.name, draining, drainRoute),
    drainRoomOccupancy: drainOccupancyFor(room.name, draining, drainRoute),
    parading,
    paradeGoal,
    paradeRoomTerrain: terrainFor(paradeRooms),
    paradeRoomOccupancy: occupancyFor(paradeRooms),
    drainAnchor: Memory.colonies[room.name]?.drainAnchor,
    paradeAnchor: Memory.colonies[room.name]?.paradeAnchor
  };
}

// The parade flag's live position, or undefined if it's been removed (see ColonySnapshot.paradeGoal's
// doc) — the one place besides empire/paradeFlags.ts that reads Game.flags, needed here because
// buildColonySnapshot runs every tick regardless of whether paradeFlags.ts has caught up yet to a flag the
// player just deleted.
function paradeGoalFor(flagName: string): (XY & { room: string }) | undefined {
  const flag = Game.flags[flagName];
  if (!flag) return undefined;
  return { x: flag.pos.x, y: flag.pos.y, room: flag.pos.roomName };
}

// Terrain for an arbitrary room set — the parade equivalent of drainTerrainFor, generalized since Parade
// has no fixed route to precompute (see paradeRoomTerrain's doc): just whichever rooms are actually in
// play this tick (home + the flag's current room). Not vision-gated, same reasoning as drainTerrainFor.
function terrainFor(rooms: ReadonlySet<string>): Partial<Record<string, Uint8Array>> {
  const out: Partial<Record<string, Uint8Array>> = {};
  for (const room of rooms) out[room] = walkablePixelsForRoom(room);
  return out;
}

// Live occupancy for an arbitrary room set — the parade equivalent of drainOccupancyFor, same
// vision-gated/obstacle rules (a room with no vision this tick has no entry).
function occupancyFor(rooms: ReadonlySet<string>): Partial<Record<string, Uint8Array>> {
  const out: Partial<Record<string, Uint8Array>> = {};
  for (const roomName of rooms) {
    const room = Game.rooms[roomName];
    if (!room) continue;
    const grid = new Uint8Array(2500);
    for (const creep of room.find(FIND_CREEPS)) grid[creep.pos.x * 50 + creep.pos.y] = 1;
    for (const structure of room.find(FIND_STRUCTURES)) {
      if ((OBSTACLE_OBJECT_TYPES as readonly string[]).includes(structure.structureType)) {
        grid[structure.pos.x * 50 + structure.pos.y] = 1;
      }
    }
    for (const source of room.find(FIND_SOURCES)) grid[source.pos.x * 50 + source.pos.y] = 1;
    for (const mineral of room.find(FIND_MINERALS)) grid[mineral.pos.x * 50 + mineral.pos.y] = 1;
    out[roomName] = grid;
  }
  return out;
}

// Terrain for every room Drain might place a squad member in — the HOME room (where the squad welds up and
// marches out from), `draining` itself, plus every room on the route between. `home` MUST be passed
// explicitly: drainRoute comes from Game.map.findRoute, which returns only the rooms to travel THROUGH and
// omits the source room entirely — so the home room is not in drainRoute at all, and a squad still forming
// up (or crossing back over) in the home room would otherwise read undefined terrain there, i.e. fail open
// to "no walls." That blindness let the anchor settle onto a home-room WALL tile it thought was clear and
// deadlock (confirmed live 2026-08-10, W5N3 drain squad frozen at (0,7) — a wall — because the home room
// had no terrain entry). Not vision-gated (unlike hostileRoomTowers/hostileRoomStorageEnergy above):
// Game.map.getRoomTerrain reads static map data for any room name, seen or not, so there's nothing to gate
// on. Small — a drain route is a handful of rooms at most — and only computed while draining is actually set.
function drainTerrainFor(home: string, draining: string | undefined, drainRoute: readonly { room: string }[]): Partial<Record<string, Uint8Array>> {
  if (!draining) return {};
  const rooms = new Set([home, draining, ...drainRoute.map(r => r.room)]);
  const out: Partial<Record<string, Uint8Array>> = {};
  for (const room of rooms) out[room] = walkablePixelsForRoom(room);
  return out;
}

// Live occupancy for every room Drain might place a squad member in — see ColonySnapshot.drainRoomOccupancy's
// doc for why this is vision-gated (only rooms in Game.rooms this tick get an entry) unlike drainTerrainFor
// above. Marks a tile 1 (occupied) if a live creep of ANY ownership (a hostile, or our own bystander — e.g.
// an unrelated operation's frozen Defender, see docs/drain-squad-handoff.md's open issue #2) stands there,
// an OBSTACLE_OBJECT_TYPES structure (a wall, spawn, extension, storage, tower, ...) not already baked
// into terrain — ramparts/roads/containers are deliberately excluded (walkable, same convention
// roadAvoidance.ts's isWalkable already uses for this exact constant) — or a natural Source/Mineral.
// Sources/minerals are genuinely impassable in the real engine (OBSTACLE_OBJECT_TYPES includes "source"
// and "mineral") but are NOT structures — FIND_STRUCTURES/structure.structureType can never see them, so
// they need their own explicit find, or the squad cost matrix reads a source tile as free ground and
// routes a formation slot onto it; the real engine then silently rejects that one member's move intent
// (checkObstacleAtXY, @screeps/engine's movement.js) while its squadmates' moves succeed, breaking
// mutual-range-1 for exactly one tick — confirmed live via test/integration/drain-squad-border-crossing.test.ts
// (a squad's own STAGING room source sat directly in the formation's advance path near the room's far edge).
// Exported for direct unit testing (see test/unit/snapshot/colony.test.ts) — buildColonySnapshot itself
// needs a much larger Game/room stub than this one function's own behavior warrants.
export function drainOccupancyFor(home: string, draining: string | undefined, drainRoute: readonly { room: string }[]): Partial<Record<string, Uint8Array>> {
  if (!draining) return {};
  const rooms = new Set([home, draining, ...drainRoute.map(r => r.room)]);
  const out: Partial<Record<string, Uint8Array>> = {};
  for (const roomName of rooms) {
    const room = Game.rooms[roomName];
    if (!room) continue; // no vision this tick — fails open via OccupancySource's own "no entry" convention
    const grid = new Uint8Array(2500);
    for (const creep of room.find(FIND_CREEPS)) grid[creep.pos.x * 50 + creep.pos.y] = 1;
    for (const structure of room.find(FIND_STRUCTURES)) {
      if ((OBSTACLE_OBJECT_TYPES as readonly string[]).includes(structure.structureType)) {
        grid[structure.pos.x * 50 + structure.pos.y] = 1;
      }
    }
    for (const source of room.find(FIND_SOURCES)) grid[source.pos.x * 50 + source.pos.y] = 1;
    for (const mineral of room.find(FIND_MINERALS)) grid[mineral.pos.x * 50 + mineral.pos.y] = 1;
    out[roomName] = grid;
  }
  return out;
}

// Room-by-room path from `home` to `target`, each tagged with its cached ScoutInfo.hostile (false when
// the room has never been scouted — see ScoutInfo's "unscouted treated as safe" convention, same as
// Drain's staging-room rule in ADR 0006). Recomputed fresh every tick rather than cached: unlike remote
// mining's route (walked by many haulers every tick, worth caching), a drain squad's route is read by
// one operation, at most once per tick, so a cheap Game.map.findRoute here is not worth persisting.
// ERR_NO_PATH (no route at all) yields an empty route — Drain's staging picker then has nothing to walk
// and simply finds no safe room, which is the correct "can't get there" signal.
function drainRouteTo(home: string, target: string): { room: string; hostile: boolean }[] {
  const route = Game.map.findRoute(home, target);
  if (route === ERR_NO_PATH) return [];
  return route.map(step => ({ room: step.room, hostile: Memory.rooms?.[step.room]?.scouted?.hostile ?? false }));
}

// A hostile worth treating as danger: can fight (ATTACK/RANGED_ATTACK), sustain a fight (HEAL), or
// dismantle a structure (WORK). An unarmed scout/claimer body has none of these and is harmless.
function isCombatCapable(c: Creep): boolean {
  return (
    c.getActiveBodyparts(ATTACK) > 0 ||
    c.getActiveBodyparts(RANGED_ATTACK) > 0 ||
    c.getActiveBodyparts(HEAL) > 0 ||
    c.getActiveBodyparts(WORK) > 0
  );
}

// Direct evidence a fight is actually happening, not just possible: one of our own creeps standing in
// the room is missing hits. Creeps only lose hits from combat (no passive decay), so this alone proves
// danger even for a body isCombatCapable's part-list doesn't recognize (e.g. an exotic boosted body).
// Kept as a second, independent signal rather than a replacement — it can't fire before the first hit
// lands, so isCombatCapable's proactive check is still what catches an ambush before any damage is dealt.
function hasDamagedFriendly(room: Room): boolean {
  return room.find(FIND_MY_CREEPS).some(c => c.hits < c.hitsMax);
}

// Live facts about each selected remote room we currently have vision of (a creep is standing in it).
// Rooms with no vision are simply absent, and buildRemoteSources falls back to memory/defaults for them.
// This is the sole Game.* read for remote data — the join itself (buildRemoteSources) stays pure.
// Every room this colony owns construction claims in: home, each selected remote's own room, and every
// transit room a remote source's cached route crosses (RemoteSourceMemory.route). mining.ts claims a
// remote source's whole road — including any pass-through room that was never itself picked as a remote,
// e.g. the road threads through a room between home and the actual remote — so a site can exist there
// too. Without the route rooms, that pass-through room's sites are invisible to siteSummary and no
// builder is ever dispatched to it (roomsWithSites only ever reads siteSummary). Exported for direct unit
// testing — buildColonySnapshot itself needs a much larger Game/room stub than this pure function warrants.
export function ownRoomsFor(
  home: string,
  remotes: readonly { room: string; sources: { route?: readonly { room: string }[] }[] }[]
): Set<string> {
  return new Set([
    home,
    ...remotes.map(r => r.room),
    ...remotes.flatMap(r => r.sources.flatMap(s => (s.route ?? []).map(t => t.room)))
  ]);
}

// `me` is our username (the home controller's owner), so a reservation we placed reads as `reserved`.
function remoteRoomVision(
  remotes: readonly { room: string; sources: { id: Id<Source> }[] }[],
  me: string | undefined
): Partial<Record<string, RemoteRoomVision>> {
  const out: Partial<Record<string, RemoteRoomVision>> = {};
  for (const remote of remotes) {
    const room = Game.rooms[remote.room];
    if (!room) continue; // no vision this tick

    const containers = room.find<StructureContainer>(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER
    });
    const openTilesBySource: Partial<Record<Id<Source>, number>> = {};
    const containerBySource: Partial<Record<Id<Source>, Id<StructureContainer>>> = {};
    for (const sel of remote.sources) {
      const source = Game.getObjectById(sel.id);
      if (!source) continue;
      openTilesBySource[sel.id] = openHarvestTiles(source);
      // A source's drop container sits on its mining spot, adjacent to the source.
      const near = containers.find(c => c.pos.isNearTo(source.pos));
      if (near) containerBySource[sel.id] = near.id;
    }

    const reservation = room.controller?.reservation;
    // Danger requires either a body that could actually hurt a miner/builder/container (proactive — catches
    // a threat before it lands a hit) or direct evidence one of our creeps is already being hurt (catches
    // any exotic body the part-list misses). An unarmed scout/claimer passing through triggers neither, so
    // it's no longer a reason to pull staffing or tear down an already-built route (see mining.ts's
    // structures() and building.ts's unsafeRemoteRooms, both gated on this).
    const allHostiles = room.find(FIND_HOSTILE_CREEPS);
    const hostiles = allHostiles.some(isCombatCapable) || hasDamagedFriendly(room) ? allHostiles : [];
    // How long the room should still be considered dangerous once we lose vision of it: the latest tick
    // any current hostile is expected to still be alive. A creep with no ticksToLive (some invader-core
    // spawned units) is treated as permanent until seen gone, so it can't under-count danger.
    const dangerUntil = hostiles.length === 0
      ? undefined
      : hostiles.reduce((latest, c) => Math.max(latest, Game.time + (c.ticksToLive ?? CREEP_LIFE_TIME)), 0);
    // Who holds the reservation, when it isn't us — e.g. "Invader" after a STRUCTURE_INVADER_CORE
    // reserves the controller. Never our own username; a reservation we placed reads via `reserved` above.
    const reservedBy = reservation !== undefined && reservation.username !== me ? reservation.username : undefined;
    out[remote.room] = {
      reserved: reservation !== undefined && reservation.username === me,
      reservedBy,
      danger: hostiles.length,
      dangerUntil,
      openTilesBySource,
      containerBySource,
      structures: room
        .find(FIND_STRUCTURES)
        .filter((s): s is AnyStructure & { structureType: BuildableStructureConstant } => s.structureType !== STRUCTURE_CONTROLLER)
        .map(snapStructure),
      sites: room.find(FIND_MY_CONSTRUCTION_SITES).map(snapStructure)
    };
  }
  return out;
}

// Energy sitting in the selected remote rooms we currently have vision of, for Logistics to haul home:
// each remote source's drop container (with energy), plus dropped piles, tombstones, and ruins anywhere
// in the room (a container-less remote miner drops on the ground). Empty without vision — the return-haul just
// waits until a miner is standing there. The sole Game.* read for remote provider data.
function remoteEnergyFor(remotes: readonly { room: string }[]): SnapRemoteEnergy[] {
  const out: SnapRemoteEnergy[] = [];
  const seen = new Set<string>();
  for (const remote of remotes) {
    if (seen.has(remote.room)) continue; // a room may host several selected sources; scan it once
    seen.add(remote.room);
    const room = Game.rooms[remote.room];
    if (!room) continue; // no vision this tick

    for (const c of room.find<StructureContainer>(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER })) {
      const amount = c.store.getUsedCapacity(RESOURCE_ENERGY);
      if (amount > 0) out.push({ id: c.id, room: remote.room, amount, kind: "container" });
    }
    for (const d of room.find(FIND_DROPPED_RESOURCES, { filter: r => r.resourceType === RESOURCE_ENERGY })) {
      out.push({ id: d.id, room: remote.room, amount: d.amount, kind: "dropped" });
    }
    for (const t of room.find(FIND_TOMBSTONES)) {
      const amount = t.store.getUsedCapacity(RESOURCE_ENERGY);
      if (amount > 0) out.push({ id: t.id, room: remote.room, amount, kind: "tombstone" });
    }
    for (const r of room.find(FIND_RUINS)) {
      const amount = r.store.getUsedCapacity(RESOURCE_ENERGY);
      if (amount > 0) out.push({ id: r.id, room: remote.room, amount, kind: "ruin" });
    }
  }
  return out;
}

// Computed once per colony and cached in ColonyMemory.anchor — never recomputed once found.
function resolveAnchor(room: Room): XY | null {
  const mem = (Memory.colonies[room.name] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
  if (mem.anchor) return mem.anchor;

  const controller = room.controller!;
  const candidates = findAnchorCandidates(walkablePixelsForRoom(room.name));
  const anchor = pickAnchor(candidates, {
    controller: { x: controller.pos.x, y: controller.pos.y },
    sources: room.find(FIND_SOURCES).map(s => ({ x: s.pos.x, y: s.pos.y }))
  });
  if (!anchor) return null;

  mem.anchor = anchor;
  return anchor;
}

function snapStructure(s: {
  id: string;
  pos: RoomPosition;
  structureType: BuildableStructureConstant;
  hits?: number;
  hitsMax?: number;
}): SnapStructure {
  const base: SnapStructure = { id: s.id as Id<Structure>, x: s.pos.x, y: s.pos.y, type: s.structureType };
  // Construction sites carry no hits; only stamp them for built structures.
  if (s.hits !== undefined && s.hitsMax !== undefined) {
    base.hits = s.hits;
    base.hitsMax = s.hitsMax;
  }
  return base;
}

// Boost-weighted sum of one part type's live (hits > 0) parts — e.g. 3 plain parts plus 2 parts boosted
// 4x is 3 + 8 = 11. Shared by healParts/attackParts/rangedAttackParts below, which only differ in which
// part type and multiplier table they read.
function boostWeightedPartCount(body: BodyPartDefinition[], type: BodyPartConstant, table: Partial<Record<string, number>>): number {
  return body.reduce((sum, part) => {
    if (part.type !== type || part.hits <= 0) return sum;
    return sum + (part.boost ? (table[part.boost] ?? 1) : 1);
  }, 0);
}

function snapUnit(c: Creep): SnapUnit {
  // creep.body (with each part's boost) is visible on any creep with vision, hostile included — so a
  // boosted enemy's real output/toughness is knowable, not just our own creeps'.
  const healParts = boostWeightedPartCount(c.body, HEAL, HEAL_BOOST_MULTIPLIER);
  const attackParts = boostWeightedPartCount(c.body, ATTACK, ATTACK_BOOST_MULTIPLIER);
  const rangedAttackParts = boostWeightedPartCount(c.body, RANGED_ATTACK, RANGED_ATTACK_BOOST_MULTIPLIER);

  const toughParts = c.body.filter(part => part.type === TOUGH && part.hits > 0);
  const toughReduction =
    toughParts.length > 0
      ? toughParts.reduce((sum, part) => sum + (part.boost ? (TOUGH_BOOST_MULTIPLIER[part.boost] ?? 1) : 1), 0) / toughParts.length
      : 1;

  return { id: c.id, x: c.pos.x, y: c.pos.y, hits: c.hits, hitsMax: c.hitsMax, healParts, attackParts, rangedAttackParts, toughReduction };
}
