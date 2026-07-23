// The spawn arbiter — an Empire capability, because spawn *routing* is cross-colony even though a
// spawn's energy is per-room. Ported from legacy SpawnManager's routing (a request carries the room
// it belongs to; a spawn in that room fills it), generalised from legacy's exact-room match to
// "nearest spawn-capable colony to the target," and stripped of everything ADR 0005 rejected: the
// persisted toSpawnList, the pause/rebuild timers, and Math.random() names.
//
// Pure: reads colony snapshots, returns spawn intents. The one Game.* touch is room distance, taken
// as an injected function so the arbiter stays unit-testable.

import { bodyCost } from "../behaviors/body";
import type { Colony } from "../colony";
import type { Intent } from "../intents/types";
import type { CreepRequest } from "../spawn/request";

// Game.map.getRoomLinearDistance, injected so tests need no Game. Manhattan-ish room-grid distance.
export type RoomDistance = (a: string, b: string) => number;

interface SpawnSlot {
  id: Id<StructureSpawn>;
  room: string;
}

// A colony's live spawn budget: energy is a shared room pool, deducted as this colony's requests are
// consumed, so two requests routed here cannot both claim the same 300 energy.
interface Purse {
  room: string;
  budget: number;
  idle: SpawnSlot[];
}

/**
 * Collect every colony's demand, sort by absolute priority, and route each request to a spawn.
 *
 * Routing per request: an explicit `spawnRoom` wins; otherwise the target room if it can spawn and
 * pay; otherwise the nearest colony that can. "Can" means a colony with an idle spawn and enough
 * energy for this body — a full/besieged colony is simply skipped and the next-nearest tried, which
 * is the re-routing legacy's frozen queue could not do.
 *
 * The livelock rule is preserved but scoped per colony: if the chosen colony cannot afford this
 * request, the request is dropped for the tick rather than a cheaper one spawned in its place — but
 * only that colony stops; other colonies keep spawning their own affordable work. (Legacy's single
 * global stop would freeze the whole empire on one colony's expensive request.)
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
      idle: c.snapshot.spawns.filter(s => !s.busy).map(s => ({ id: s.id, room: c.name }))
    });
  }

  const out: Intent[] = [];
  for (const request of requests) {
    const purse = pickPurse(request, purses, roomDistance);
    if (!purse) continue; // nowhere can spawn this right now — re-derived next tick
    const slot = purse.idle.shift()!; // pickPurse guarantees one
    out.push({ kind: "spawn", spawn: slot.id, body: request.body, memory: request.memory });
    purse.budget -= bodyCost(request.body);
  }
  return out;
}

// The colony that should spawn this request, or undefined if none can right now. Consumes nothing —
// the caller takes the slot only once committed.
function pickPurse(
  request: CreepRequest,
  purses: Map<string, Purse>,
  roomDistance: RoomDistance
): Purse | undefined {
  const cost = bodyCost(request.body);
  const canServe = (p: Purse | undefined): p is Purse => !!p && p.idle.length > 0 && p.budget >= cost;

  // Manual pin: spawn here or not at all. A pinned room that cannot pay waits rather than leaking
  // the creep to another colony — the request is deliberately room-specific.
  if (request.spawnRoom) {
    const pinned = purses.get(request.spawnRoom);
    return canServe(pinned) ? pinned : undefined;
  }

  // The target room first — a creep is cheapest to spawn where it is needed (no cross-room walk).
  const target = purses.get(request.targetRoom);
  if (canServe(target)) return target;

  // Otherwise the nearest colony that can serve it. Legacy's findnearestBaseOp, made routine.
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
  return best;
}
