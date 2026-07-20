// Builds snapshots from Game state — the only place planners' input touches
// the live API (docs/rewrite-skeleton.md §1).

import { findAnchorCandidates, pickAnchor, walkablePixelsForRoom } from "../layouts/stamp";
import type { XY } from "../lib/geometry";
import { censusByColony, type CensusCreep } from "./census";
import type { Census, ColonySnapshot, EmpireSnapshot, SnapStructure, SnapUnit } from "./types";

export function buildEmpireSnapshot(): EmpireSnapshot {
  // One pass over all creeps -> census keyed by home colony (skeleton §4).
  const census = censusByColony(
    Object.values(Game.creeps).map<CensusCreep>(c => ({
      home: c.memory.home,
      role: c.memory.role,
      spawning: c.spawning
    }))
  );

  const colonies: ColonySnapshot[] = [];
  for (const name in Game.rooms) {
    const room = Game.rooms[name];
    if (!room.controller?.my) continue;
    colonies.push(buildColonySnapshot(room, census[name] ?? {}));
  }
  return { tick: Game.time, colonies };
}

function buildColonySnapshot(room: Room, census: Census): ColonySnapshot {
  const controller = room.controller!;
  const myCreeps = room.find(FIND_MY_CREEPS);
  return {
    name: room.name,
    towers: room
      .find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_TOWER })
      .map(t => ({ id: t.id as Id<StructureTower>, x: t.pos.x, y: t.pos.y })),
    hostiles: room.find(FIND_HOSTILE_CREEPS).map(snapUnit),
    woundedFriendlies: myCreeps.filter(c => c.hits < c.hitsMax).map(snapUnit),
    safeModeAvailable:
      controller.safeModeAvailable > 0 && !controller.safeMode && !controller.safeModeCooldown,
    census,
    spawns: room
      .find(FIND_MY_STRUCTURES, { filter: s => s.structureType === STRUCTURE_SPAWN })
      .map(s => ({ id: s.id as Id<StructureSpawn>, busy: (s as StructureSpawn).spawning !== null })),
    energyAvailable: room.energyAvailable,
    energyCapacity: room.energyCapacityAvailable,
    sources: room.find(FIND_SOURCES).length,
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
    structures: room
      .find(FIND_STRUCTURES)
      .filter((s): s is AnyStructure & { structureType: BuildableStructureConstant } => s.structureType !== STRUCTURE_CONTROLLER)
      .map(snapStructure),
    sites: room.find(FIND_MY_CONSTRUCTION_SITES).map(snapStructure),
    constructionProgress: room
      .find(FIND_CONSTRUCTION_SITES)
      .reduce((remaining, site) => remaining + (site.progressTotal - site.progress), 0)
  };
}

// Bunker anchor: computed once per colony and cached in ColonyMemory.anchor
// (building.ts, issue #16) — never recomputed once found. Only building.ts's
// planner logic needs to be unit-testable/fixture-only; this terrain lookup
// is the one place that's allowed to touch Game.map.
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
