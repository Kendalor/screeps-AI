// The actuator: calls the game API and logs any non-OK result. Non-game side effects (e.g. recordSourceSpot's Memory write) live here too, so planners stay pure.

import { log } from "../lib/log";
import { roomType } from "../lib/roomName";
import type { RouteMemory, ScoutInfo } from "../memory/schema";
import type { Intent } from "./types";

// The farthest the scouting frontier grows, in rooms. Legacy's MAX_RANGE. Lives here because
// advanceScoutRadius owns the radius write and its bounds.
const MAX_SCOUT_RANGE = 6;

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
      // Directions are a *preference*, never a lock: pass every walkable exit, road-adjacent first,
      // so a newborn creep still emerges even when its preferred tile is occupied (e.g. an idling
      // supply creep). A single-direction list would strand the creep at 100% progress.
      const dirs = intent.dir !== undefined ? [intent.dir] : spawnExitDirections(spawn);
      return dirs.length > 0
        ? spawn.spawnCreep(intent.body, name, { memory: intent.memory, dryRun: false, directions: dirs })
        : spawn.spawnCreep(intent.body, name, { memory: intent.memory, dryRun: false });
    }
    case "placeSite": {
      const room = Game.rooms[intent.room];
      if (!room) return ERR_NOT_FOUND;
      return room.createConstructionSite(intent.x, intent.y, intent.type);
    }
    case "setCreepRole": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      if (creep.memory.role === intent.role) return OK; // already converted; idempotent
      creep.memory.role = intent.role;
      // Fresh step loop for the new role — the old task index/lock belonged to the builder's steps.
      creep.memory.task = undefined;
      // Drop the owning-operation stamp: the creep is no longer a builder Building owns, and clearing it
      // lets the new role's owner (Upgrading, or a future repair owner) count it toward its quota.
      creep.memory.op = undefined;
      return OK;
    }
    case "assignLogisticsTask": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      // Split the paired follow-up out of the task: `current` holds the leg to run now, `next` the leg
      // runTransport promotes the moment this one completes — so a pickup flows into its deliver with no
      // idle re-plan tick between them. A deliver-only assignment carries no `next` and clears it.
      const { next, ...current } = intent.task;
      creep.memory.logistics = { current, next };
      return OK;
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
    case "recordScout": {
      const room = Game.rooms[intent.room];
      // Vision must actually be present for the observation to be real — the operation only emits this
      // for a room with vision in the snapshot, but a tick-boundary loss (creep died, moved on) is possible.
      if (!room) return ERR_NOT_FOUND;
      // Memory.rooms may not exist yet on a fresh isolate; create the container before indexing it.
      const rooms = (Memory.rooms ??= {});
      const mem = (rooms[intent.room] ??= {} as RoomMemory);
      mem.scouted = observeRoom(room, intent.passive ? mem.scouted : undefined);
      return OK;
    }
    case "setScoutTarget": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      // Recorded before overwriting scoutTarget so the next pick can avoid sending the scout straight
      // back here — without it, two rooms mutually nearest each other ping-pong a scout forever.
      creep.memory.lastRoom = creep.room.name;
      creep.memory.scoutTarget = intent.targetRoom;
      creep.memory.route = routeTo(creep.room.name, intent.targetRoom);
      return OK;
    }
    case "advanceScoutRadius": {
      const mem = (Memory.scouting ??= { radius: 1 });
      if (mem.radius < MAX_SCOUT_RANGE) mem.radius += 1;
      return OK;
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

// What a room's vision shows, distilled to ScoutInfo. Lives here (not a planner) since it reads a live Room.
// `previous`: a passive observation's prior record, if any — its static fields (sources/mineral never
// move) are reused instead of re-running FIND_SOURCES/FIND_MINERALS, so ambient vision refreshing many
// rooms every tick stays cheap. An active (non-passive) observation always re-finds everything, since a
// scout's arrival is comparatively rare and correctness of a first-ever survey matters more than cost.
function observeRoom(room: Room, previous: ScoutInfo | undefined): ScoutInfo {
  const c = room.controller;
  const owner = c?.owner?.username ?? c?.reservation?.username;
  const staticKnown = previous?.sources !== undefined;
  const mineral = staticKnown ? previous.mineral : room.find(FIND_MINERALS)[0]?.mineralType;
  const sources = staticKnown ? previous.sources : room.find(FIND_SOURCES).map(s => ({ id: s.id, x: s.pos.x, y: s.pos.y }));
  return {
    tick: Game.time,
    type: roomType(room.name),
    sources,
    ...(mineral ? { mineral } : {}),
    ...(owner ? { owner } : {}),
    hostile: owner !== undefined && !c?.my
  };
}

// Room-by-room route via Game.map.findRoute; on failure, falls back to just the destination.
function routeTo(from: string, dest: string): RouteMemory {
  const route = Game.map.findRoute(from, dest);
  const rooms = route === ERR_NO_PATH ? [dest] : route.map(step => step.room);
  return { dest, rooms, index: 0 };
}

// All walkable exits around the spawn, ordered as a preference: road tiles first (so the newborn
// lands on a road and doesn't block the spawn), then other open tiles as fallbacks. Passing every
// viable direction — not just one — means an occupied preferred tile can't strand a finished creep.
const ALL_DIRECTIONS: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];

function spawnExitDirections(spawn: StructureSpawn): DirectionConstant[] {
  const terrain = spawn.room.getTerrain();
  const walkable: { dir: DirectionConstant; road: boolean }[] = [];
  for (const dir of ALL_DIRECTIONS) {
    const pos = posInDirection(spawn.pos, dir);
    if (!pos) continue; // off the edge of the room
    if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) continue;
    const structures = pos.lookFor(LOOK_STRUCTURES);
    const blocked = structures.some(
      s => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_CONTAINER && s.structureType !== STRUCTURE_RAMPART
    );
    if (blocked) continue;
    walkable.push({ dir, road: structures.some(s => s.structureType === STRUCTURE_ROAD) });
  }
  // Stable sort keeping the clockwise ALL_DIRECTIONS order within each group; road tiles float to the front.
  return walkable.sort((a, b) => Number(b.road) - Number(a.road)).map(w => w.dir);
}

function posInDirection(pos: RoomPosition, dir: DirectionConstant): RoomPosition | undefined {
  const deltas: Record<DirectionConstant, [number, number]> = {
    [TOP]: [0, -1],
    [TOP_RIGHT]: [1, -1],
    [RIGHT]: [1, 0],
    [BOTTOM_RIGHT]: [1, 1],
    [BOTTOM]: [0, 1],
    [BOTTOM_LEFT]: [-1, 1],
    [LEFT]: [-1, 0],
    [TOP_LEFT]: [-1, -1]
  };
  const [dx, dy] = deltas[dir];
  const x = pos.x + dx;
  const y = pos.y + dy;
  if (x < 0 || x > 49 || y < 0 || y > 49) return undefined;
  return new RoomPosition(x, y, pos.roomName);
}
