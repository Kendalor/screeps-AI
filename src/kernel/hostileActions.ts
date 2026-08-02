// Auto-reputation: scans every visible room's event log each tick for an EVENT_ATTACK landing on
// something of ours, then marks the attacker's owner hostile (see memory/reputation.ts). Runs every tick,
// untiered — an event log is only available the tick it happened, so skipping a tick under CPU pressure
// means that attack is gone forever, unlike a tier-3 system's "try again next interval".

import { recordHostileAction } from "../memory/reputation";

export function scanHostileActions(): void {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    for (const event of room.getEventLog()) {
      if (event.event !== EVENT_ATTACK) continue;
      const target = Game.getObjectById(event.data.targetId as Id<_HasId>);
      if (!target || !isOurs(target)) continue;
      const attacker = Game.getObjectById(event.objectId as Id<Creep | PowerCreep>);
      const owner = attacker && "owner" in attacker ? attacker.owner?.username : undefined;
      if (owner) recordHostileAction(owner);
    }
  }
}

function isOurs(target: object): boolean {
  return "my" in target && target.my === true;
}
