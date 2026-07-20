// The actuator: the one switch that calls the game API and checks return
// codes. Every non-OK result is logged with the intent that caused it —
// failed actions are visible, never silent (docs/rewrite-skeleton.md §4).
//
// Side effects that are not game-API calls land here too (recordSourceSpot
// writes Memory), for the same reason: planners stay pure, and everything that
// mutates the world is in one place.

import { log } from "../lib/log";
import type { Intent } from "./types";

export function execute(intents: Intent[]): void {
  for (const intent of intents) {
    const result = act(intent);
    if (result !== OK) {
      log.warn(`intent failed (${result}): ${JSON.stringify(intent)}`);
    }
  }
}

function act(intent: Intent): ScreepsReturnCode {
  switch (intent.kind) {
    case "towerAttack": {
      const tower = Game.getObjectById(intent.tower);
      const target = Game.getObjectById(intent.target);
      if (!tower || !target) return ERR_NOT_FOUND;
      return tower.attack(target);
    }
    case "towerHeal": {
      const tower = Game.getObjectById(intent.tower);
      const target = Game.getObjectById(intent.target);
      if (!tower || !target) return ERR_NOT_FOUND;
      return tower.heal(target);
    }
    case "safeMode": {
      const controller = Game.rooms[intent.room]?.controller;
      if (!controller) return ERR_NOT_FOUND;
      return controller.activateSafeMode();
    }
    case "spawn": {
      const spawn = Game.getObjectById(intent.spawn);
      if (!spawn) return ERR_NOT_FOUND;
      // Deterministic name — no random-name collisions, no orphaned bookkeeping.
      const name = `${intent.role}_${intent.memory.home}_${Game.time}`;
      // Dry run first (ported from SpawnManager.run) so failures never leave a
      // half-spawned state and the real call can carry a spawn direction.
      const dry = spawn.spawnCreep(intent.body, name, { memory: intent.memory, dryRun: true });
      if (dry !== OK) return dry;
      const dir = intent.dir ?? directionToAdjacentRoad(spawn);
      return dir !== undefined
        ? spawn.spawnCreep(intent.body, name, { memory: intent.memory, dryRun: false, directions: [dir] })
        : spawn.spawnCreep(intent.body, name, { memory: intent.memory, dryRun: false });
    }
    case "placeSite": {
      const room = Game.rooms[intent.room];
      if (!room) return ERR_NOT_FOUND;
      return room.createConstructionSite(intent.x, intent.y, intent.type);
    }
    case "removeStructure": {
      // Defense in depth: planBuilding never emits this for a spawn, but the
      // actuator is the last line of defense — losing the only spawn mid-migration
      // is colony-fatal, so a spawn is never destroyed here regardless of intent.
      if (intent.type === "spawn") {
        log.error(`refusing removeStructure for a spawn: ${JSON.stringify(intent)}`);
        return OK;
      }
      const room = Game.rooms[intent.room];
      const structure = room
        ?.lookForAt(LOOK_STRUCTURES, intent.x, intent.y)
        .find(s => s.structureType === intent.type);
      if (!structure) return ERR_NOT_FOUND;
      return structure.destroy();
    }
    case "recordSourceSpot": {
      // The one intent that writes Memory rather than calling the game API:
      // mining's planner stays pure, so persistence lands here with the rest
      // of the side effects.
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0 });
      const source = (mem.sources[intent.source] ??= {});
      source.spot = intent.spot;
      // Only ever add an id — a tick that resolved none (no vision, mid-rebuild)
      // must not wipe the handle roles are already using.
      if (intent.container) source.containerId = intent.container;
      if (intent.link) source.linkId = intent.link;
      return OK;
    }
    default:
      log.error(`no actuator for intent kind "${intent.kind}" yet`);
      return OK; // already logged; don't double-report as a failed action
  }
}

// Ported from SpawnManager.run: spawn toward an adjacent road so the newborn
// creep steps onto the bunker's road network instead of blocking the spawn.
function directionToAdjacentRoad(spawn: StructureSpawn): DirectionConstant | undefined {
  const road = spawn.pos
    .findInRange(FIND_STRUCTURES, 1)
    .find(str => str.structureType === STRUCTURE_ROAD);
  return road ? spawn.pos.getDirectionTo(road) : undefined;
}
