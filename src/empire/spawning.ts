// Spawn arbiter: cross-colony routing since a request can be filled by any spawn-capable colony, not just its own room.
// Pure: reads colony snapshots, returns spawn intents; room distance is injected so this stays unit-testable.

import { bodyCost } from "../spawn/body";
import type { Colony } from "../colony";
import type { Intent } from "../intents/types";
import type { CreepRequest } from "../spawn/request";

// Injected room-grid distance (Game.map.getRoomLinearDistance) so tests need no Game.
export type RoomDistance = (a: string, b: string) => number;

interface SpawnSlot {
  id: Id<StructureSpawn>;
  room: string;
}

// A colony's live spawn budget; capacity is the room's full energy ceiling, used to tell "can't afford yet" from "can never afford."
interface Purse {
  room: string;
  budget: number;
  capacity: number;
  idle: SpawnSlot[];
}

/**
 * Collect every colony's demand, sort by priority, and route each request to a spawn (nearest affordable colony, or a pinned spawnRoom).
 * A colony that can't afford its top request stops for the tick rather than letting a cheaper request leapfrog it, but other colonies are unaffected.
 */
export function planSpawning(colonies: Colony[], roomDistance: RoomDistance): Intent[] {
  const requests = colonies
    .flatMap(c => c.requests())
    .sort((a, b) => b.priority - a.priority);
  if (requests.length === 0) return [];

  const purses = new Map<string, Purse>();
  for (const c of colonies) {
    purses.set(c.name, {
      room: c.name,
      budget: c.snapshot.energyAvailable,
      capacity: c.snapshot.energyCapacity,
      idle: c.snapshot.spawns.filter(s => !s.busy).map(s => ({ id: s.id, room: c.name }))
    });
  }

  // Colonies whose top request they couldn't afford; their cheaper requests are withheld this tick (livelock guard), scoped per colony.
  const stopped = new Set<string>();

  const out: Intent[] = [];
  for (const request of requests) {
    const choice = pickPurse(request, purses, roomDistance, stopped);
    if (choice.stop) stopped.add(choice.stop);
    if (!choice.purse) continue; // nowhere can spawn this right now
    const slot = choice.purse.idle.shift()!; // pickPurse guarantees one
    out.push({ kind: "spawn", spawn: slot.id, body: request.body, memory: request.memory });
    choice.purse.budget -= bodyCost(request.body);
  }
  return out;
}

// Outcome of routing one request: the purse to spend from (if any), and independently, the colony to stop (if it had a spawn but couldn't pay).
interface Choice {
  purse?: Purse;
  stop?: string;
}

// The colony that should spawn this request; consumes nothing until the caller commits. A colony already in `stopped` can't serve.
function pickPurse(
  request: CreepRequest,
  purses: Map<string, Purse>,
  roomDistance: RoomDistance,
  stopped: ReadonlySet<string>
): Choice {
  const cost = bodyCost(request.body);
  const hasSpawn = (p: Purse | undefined): p is Purse => !!p && !stopped.has(p.room) && p.idle.length > 0;
  const canServe = (p: Purse | undefined): p is Purse => hasSpawn(p) && p.budget >= cost;
  // Stop the colony only if it had a free spawn and could afford it eventually (cost within full capacity) — otherwise skip, don't wait forever.
  const stopRoom = (p: Purse | undefined): string | undefined =>
    hasSpawn(p) && cost <= p.capacity ? p.room : undefined;

  // Manual pin: spawn here or not at all — never leak to another colony.
  if (request.spawnRoom) {
    const pinned = purses.get(request.spawnRoom);
    return canServe(pinned) ? { purse: pinned } : { stop: stopRoom(pinned) };
  }

  // Target room first — cheapest to spawn where the creep is needed.
  const target = purses.get(request.targetRoom);
  if (canServe(target)) return { purse: target };

  // Otherwise the nearest colony that can serve it.
  let best: Purse | undefined;
  let bestDist = Infinity;
  for (const purse of purses.values()) {
    if (!canServe(purse)) continue;
    const d = roomDistance(request.targetRoom, purse.room);
    if (d < bestDist) {
      bestDist = d;
      best = purse;
    }
  }
  if (best) return { purse: best };

  // Nowhere can pay — stop the home colony if it's the one that fell short.
  return { stop: stopRoom(target) };
}
