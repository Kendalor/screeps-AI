// Builds snapshots from Game state — the only place planners' input touches
// the live API (docs/rewrite-skeleton.md §1).

import { censusByColony, type CensusCreep } from "./census";
import type { Census, ColonySnapshot, EmpireSnapshot, SnapUnit } from "./types";

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
    storageEnergy: room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0
  };
}

function snapUnit(c: Creep): SnapUnit {
  return { id: c.id, x: c.pos.x, y: c.pos.y, hits: c.hits, hitsMax: c.hitsMax };
}
