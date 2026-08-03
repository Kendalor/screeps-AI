// Builds snapshots from Game state — the only place planners' input touches the live API.

import { openHarvestTiles } from "../behaviors/targets";
import { findAnchorCandidates, pickAnchor, walkablePixelsForRoom } from "../layouts/stamp";
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
  SnapUnit,
  VisibleRoom
} from "./types";

export const buildEmpireSnapshot = wrapFn(function buildEmpireSnapshot(): EmpireSnapshot {
  // One pass over all creeps -> grouped by home colony.
  const byColony = censusByColony(Object.values(Game.creeps).map(snapCreep));
  // Shared across colonies: every room with vision this tick, regardless of which colony (if any) owns it.
  const visibleRooms: VisibleRoom[] = Object.keys(Game.rooms).map(name => {
    const r = Game.rooms[name];
    const invaderCore = r
      .find(FIND_HOSTILE_STRUCTURES)
      .find((s): s is StructureInvaderCore => s.structureType === STRUCTURE_INVADER_CORE);
    return {
      room: name,
      info: Memory.rooms?.[name]?.scouted,
      hostileCount: r.find(FIND_HOSTILE_CREEPS).length + r.find(FIND_HOSTILE_STRUCTURES).length,
      ...(invaderCore ? { invaderCoreLevel: invaderCore.level } : {})
    };
  });

  const colonies: ColonySnapshot[] = [];
  for (const name in Game.rooms) {
    const room = Game.rooms[name];
    if (!room.controller?.my) continue;
    colonies.push(buildColonySnapshot(room, byColony[name] ?? [], Game.time, visibleRooms));
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
    storeEnergy: c.store.getUsedCapacity(RESOURCE_ENERGY),
    storeCapacity: c.store.getCapacity(),
    memory: c.memory
  };
}

function buildColonySnapshot(room: Room, creeps: SnapCreep[], tick: number, visibleRooms: VisibleRoom[]): ColonySnapshot {
  const controller = room.controller!;
  const myCreeps = room.find(FIND_MY_CREEPS);
  const remotes = Memory.colonies[room.name]?.remotes ?? [];
  const colonizing = Memory.colonies[room.name]?.colonizing ?? [];
  const attacking = Memory.colonies[room.name]?.attacking ?? [];
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
  // so the shared construction budget (colony/building.ts) can count a remote site even between the
  // ticks a creep gives it vision. Scoped to this colony's own rooms — Game.constructionSites is
  // empire-wide across every colony the player owns.
  const ownRooms = new Set([room.name, ...remotes.map(r => r.room)]);
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
    scoutTargets: scoutCandidatesAround(room.name, Memory.scouting?.radius ?? 1),
    visibleRooms,
    colonizing,
    attacking
  };
}

// Live facts about each selected remote room we currently have vision of (a creep is standing in it).
// Rooms with no vision are simply absent, and buildRemoteSources falls back to memory/defaults for them.
// This is the sole Game.* read for remote data — the join itself (buildRemoteSources) stays pure.
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
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
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
  const mem = (Memory.colonies[room.name] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [] });
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

// Heal-boost multipliers, tier 1-3 (LO/LHO2/XLHO2) — mirrors the game's BOOSTS.heal.heal table, which
// has no ambient runtime type (see GAME_TOWER_* in defense.ts for why these constants are hand-mirrored).
const HEAL_BOOST_MULTIPLIER: Partial<Record<string, number>> = {
  [RESOURCE_LEMERGIUM_OXIDE]: 1.5,
  [RESOURCE_LEMERGIUM_ALKALIDE]: 3,
  [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: 4
};

function snapUnit(c: Creep): SnapUnit {
  // creep.body (with each part's boost) is visible on any creep with vision, hostile included — so a
  // boosted enemy healer's real output is knowable, not just our own creeps'.
  const healParts = c.body.reduce((sum, part) => {
    if (part.type !== HEAL || part.hits <= 0) return sum;
    return sum + (part.boost ? (HEAL_BOOST_MULTIPLIER[part.boost] ?? 1) : 1);
  }, 0);
  return { id: c.id, x: c.pos.x, y: c.pos.y, hits: c.hits, hitsMax: c.hitsMax, healParts };
}
