// A builder/repairer/upgrader that stops to work can end up parked on a road, blocking travelling
// creeps for as long as the job takes. stepOffRoad nudges it onto a free non-road tile without
// sacrificing range to the work target — same shape as interpreter.ts's drawCloserToController, but
// keyed on road-avoidance rather than "closer is better".

import { roleDef } from "./roles";

const NEARBY_MOVER_RANGE = 2;

// Cheap early-out: don't bother evacuating a road tile unless some road-using creep (Role.mover, e.g.
// hauler/transport/supply/scout/defender) is actually nearby to want it. Most ticks nobody's within
// range, so this skips the tile-search/travelTo work below entirely.
function moverNearby(pos: RoomPosition, self: Creep): boolean {
  for (let x = Math.max(0, pos.x - NEARBY_MOVER_RANGE); x <= Math.min(49, pos.x + NEARBY_MOVER_RANGE); x++) {
    for (let y = Math.max(0, pos.y - NEARBY_MOVER_RANGE); y <= Math.min(49, pos.y + NEARBY_MOVER_RANGE); y++) {
      const found = new RoomPosition(x, y, pos.roomName)
        .lookFor(LOOK_CREEPS)
        .some(creep => creep.id !== self.id && roleDef(creep.memory.role)?.mover);
      if (found) return true;
    }
  }
  if (Memory.debugMetrics) console.log(`ROADAVOID_MARKER_v2 ${self.name} no mover found near ${pos.x},${pos.y}`);
  return false;
}

function isRoad(pos: RoomPosition): boolean {
  return pos.lookFor(LOOK_STRUCTURES).some(s => s.structureType === STRUCTURE_ROAD);
}

function isFreeForCreep(pos: RoomPosition, creep: Creep): boolean {
  const occupant = pos.lookFor(LOOK_CREEPS)[0];
  return !occupant || occupant.id === creep.id;
}

function isWalkable(pos: RoomPosition): boolean {
  const terrain = Game.rooms[pos.roomName]?.getTerrain();
  if (terrain && terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;
  // Terrain alone isn't enough — a plain tile can still hold an impassable building (storage, spawn,
  // extension, wall, ...). Confirmed live: a builder's stepOffRoad candidate landed on a storage tile,
  // travelTo could never actually arrive, and the builder sat on the road blocking traffic forever.
  return !pos.lookFor(LOOK_STRUCTURES).some(s => (OBSTACLE_OBJECT_TYPES as readonly string[]).includes(s.structureType));
}

// Every in-room tile within `range` of workPos (a square, not just the boundary ring), nearest first —
// so a free non-road tile right next to the creep's current spot wins over one at the far edge of range.
function tilesInRange(workPos: RoomPosition, range: number, from: { x: number; y: number }): RoomPosition[] {
  const tiles: RoomPosition[] = [];
  for (let x = Math.max(0, workPos.x - range); x <= Math.min(49, workPos.x + range); x++) {
    for (let y = Math.max(0, workPos.y - range); y <= Math.min(49, workPos.y + range); y++) {
      tiles.push(new RoomPosition(x, y, workPos.roomName));
    }
  }
  return tiles.sort(
    (a, b) => Math.max(Math.abs(a.x - from.x), Math.abs(a.y - from.y)) - Math.max(Math.abs(b.x - from.x), Math.abs(b.y - from.y))
  );
}

/** If the creep is standing on a road, step onto the nearest free non-road tile still within range of workPos. No-op otherwise. */
export function stepOffRoad(creep: Creep, workPos: RoomPosition, range: number): void {
  if (!isRoad(creep.pos)) return;
  if (!moverNearby(creep.pos, creep)) return;

  const candidate = tilesInRange(workPos, range, creep.pos).find(
    pos => !pos.isEqualTo(creep.pos) && !isRoad(pos) && isWalkable(pos) && isFreeForCreep(pos, creep)
  );
  if (candidate) creep.travelTo(candidate);
}
