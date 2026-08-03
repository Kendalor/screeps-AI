// Auto-reputation: scans every visible room's event log each tick for an EVENT_ATTACK landing on
// something of ours, then marks the attacker's owner hostile (see memory/reputation.ts). Runs every tick,
// untiered — an event log is only available the tick it happened, so skipping a tick under CPU pressure
// means that attack is gone forever, unlike a tier-3 system's "try again next interval".

import { roomType } from "../lib/roomName";
import { isDangerous, recordHostileAction } from "../memory/reputation";

export function scanHostileActions(): void {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    const events = room.getEventLog();
    for (const event of events) {
      if (event.event !== EVENT_ATTACK) continue;
      const target = Game.getObjectById(event.data.targetId as Id<_HasId>);
      if (!target || !isOurs(target)) continue;
      const attacker = Game.getObjectById(event.objectId as Id<Creep | PowerCreep>);
      const owner = attacker && "owner" in attacker ? attacker.owner?.username : undefined;
      if (owner) recordHostileAction(owner);
    }
    recordLethalRoom(roomName, events);
  }
}

function isOurs(target: object): boolean {
  return "my" in target && target.my === true;
}

// A creep of ours destroyed the same tick it was attacked is already gone from Game state by the time this
// scan runs (engine resolves combat after scripts finish, so the kill only shows up in next tick's event
// log) — EVENT_ATTACK's own targetId no longer resolves via Game.getObjectById, so isOurs above silently
// skips exactly the case that matters most here (see schema.ts's ScoutInfo.lethalAt doc). Rather than try
// to prove which EVENT_OBJECT_DESTROYED was one of ours post-mortem, this keys off the room instead: any
// destruction event in a room whose last-scouted owner is reputation-flagged hostile/dangerous is treated
// as a kill worth remembering. A hostile owner's own creep dying there (e.g. to our defenders) triggers the
// same write, but that only makes the room's lethal-cache backoff a little more conservative than strictly
// necessary — it never causes a safe room to be wrongly avoided, since a room with no hostile owner on
// record never reaches this branch at all.
function recordLethalRoom(roomName: string, events: readonly { event: number }[]): void {
  if (!events.some(e => e.event === EVENT_OBJECT_DESTROYED)) return;
  const info = Memory.rooms?.[roomName]?.scouted;
  if (!isDangerous(info?.owner)) return;
  const rooms = (Memory.rooms ??= {});
  const roomMem = (rooms[roomName] ??= {});
  const scouted = (roomMem.scouted ??= { type: roomType(roomName), sources: [], hostile: true });
  scouted.lethalAt = Game.time;
}
