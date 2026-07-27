// Builds snapshots from Game state — the only place planners' input touches the live API.

import { openHarvestTiles } from "../behaviors/targets";
import { findAnchorCandidates, pickAnchor, walkablePixelsForRoom } from "../layouts/stamp";
import type { XY } from "../lib/geometry";
import { censusByColony } from "./census";
import { scoutCandidatesAround } from "./scoutGraph";
import type { ColonySnapshot, EmpireSnapshot, SnapCreep, SnapStructure, SnapUnit, VisibleRoom } from "./types";

export function buildEmpireSnapshot(): EmpireSnapshot {
  // One pass over all creeps -> grouped by home colony.
  const byColony = censusByColony(Object.values(Game.creeps).map(snapCreep));
  // Shared across colonies: every room with vision this tick, regardless of which colony (if any) owns it.
  const visibleRooms: VisibleRoom[] = Object.keys(Game.rooms).map(name => ({
    room: name,
    info: Memory.rooms?.[name]?.scouted
  }));

  const colonies: ColonySnapshot[] = [];
  for (const name in Game.rooms) {
    const room = Game.rooms[name];
    if (!room.controller?.my) continue;
    colonies.push(buildColonySnapshot(room, byColony[name] ?? [], Game.time, visibleRooms));
  }
  return { tick: Game.time, colonies };
}

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
    memory: c.memory
  };
}

function buildColonySnapshot(room: Room, creeps: SnapCreep[], tick: number, visibleRooms: VisibleRoom[]): ColonySnapshot {
  const controller = room.controller!;
  const myCreeps = room.find(FIND_MY_CREEPS);
  return {
    name: room.name,
    tick,
    towers: room
      .find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER })
      .map(t => ({ id: t.id as Id<StructureTower>, x: t.pos.x, y: t.pos.y })),
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
    energyAvailable: room.energyAvailable,
    energyCapacity: room.energyCapacityAvailable,
    sources: room.find(FIND_SOURCES).map(s => ({ id: s.id, x: s.pos.x, y: s.pos.y, openTiles: openHarvestTiles(s) })),
    drops: room.find(FIND_DROPPED_RESOURCES).map(d => ({ id: d.id, x: d.pos.x, y: d.pos.y, amount: d.amount })),
    terrain: walkablePixelsForRoom(room.name),
    controller: { x: controller.pos.x, y: controller.pos.y },
    controllerLevel: controller.level,
    controllerProgress: controller.progress,
    storageEnergy: room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
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
    anchor: resolveAnchor(room),
    sourceMemory: Memory.colonies[room.name]?.sources ?? {},
    structures: room
      .find(FIND_STRUCTURES)
      .filter((s): s is AnyStructure & { structureType: BuildableStructureConstant } => s.structureType !== STRUCTURE_CONTROLLER)
      .map(snapStructure),
    sites: room.find(FIND_MY_CONSTRUCTION_SITES).map(snapStructure),
    constructionProgress: room
      .find(FIND_CONSTRUCTION_SITES)
      .reduce((remaining, site) => remaining + (site.progressTotal - site.progress), 0),
    // Rooms within the current scouting radius; radius grows as the frontier is exhausted.
    scoutTargets: scoutCandidatesAround(room.name, Memory.scouting?.radius ?? 1),
    visibleRooms
  };
}

// Computed once per colony and cached in ColonyMemory.anchor — never recomputed once found.
function resolveAnchor(room: Room): XY | null {
  const mem = (Memory.colonies[room.name] ??= { sources: {}, remotes: [], danger: 0 });
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

function snapStructure(s: { pos: RoomPosition; structureType: BuildableStructureConstant }): SnapStructure {
  return { x: s.pos.x, y: s.pos.y, type: s.structureType };
}

function snapUnit(c: Creep): SnapUnit {
  return { id: c.id, x: c.pos.x, y: c.pos.y, hits: c.hits, hitsMax: c.hitsMax };
}
