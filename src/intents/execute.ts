// The actuator: calls the game API and logs any non-OK result. Non-game side effects (e.g. recordSourceSpot's Memory write) live here too, so planners stay pure.

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
      const name = `${intent.memory.role}_${intent.memory.home}_${Game.time}`;
      // Dry run first so a failure never leaves a half-spawned state.
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
      // Last line of defense: never destroy a spawn here, regardless of intent.
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
    case "roomVisual": {
      const visual = new RoomVisual(intent.room);
      for (const o of intent.ops) {
        if (o.op === "text") {
          visual.text(o.text, o.x, o.y, {
            color: o.color,
            align: o.align,
            font: o.size ? `${o.size} monospace` : "monospace"
          });
        } else {
          visual.rect(o.x, o.y, o.w, o.h, { fill: o.fill, opacity: o.opacity });
        }
      }
      return OK; // RoomVisual calls never fail with a return code
    }
    case "recordSourceSpot": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0 });
      const source = (mem.sources[intent.source] ??= {});
      source.spot = intent.spot;
      // Only ever add an id — a tick with no vision must not wipe an existing handle.
      if (intent.container) source.containerId = intent.container;
      if (intent.link) source.linkId = intent.link;
      return OK;
    }
    default:
      log.error(`no actuator for intent kind "${intent.kind}" yet`);
      return OK; // already logged; don't double-report
  }
}

// Spawn toward an adjacent road so the newborn creep doesn't block the spawn.
function directionToAdjacentRoad(spawn: StructureSpawn): DirectionConstant | undefined {
  const road = spawn.pos
    .findInRange(FIND_STRUCTURES, 1)
    .find(str => str.structureType === STRUCTURE_ROAD);
  return road ? spawn.pos.getDirectionTo(road) : undefined;
}
