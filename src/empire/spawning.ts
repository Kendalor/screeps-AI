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
// consumed, so two requests routed here cannot both claim the same 300 energy. `capacity` is the
// room's *full* energy — the ceiling a refill could ever reach — so the arbiter can tell a request
// it can't afford right now (wait) from one it could never afford even full (skip).
interface Purse {
  room: string;
  budget: number;
  capacity: number;
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
 * request *right now*, the request is dropped for the tick rather than a cheaper one spawned in its
 * place — but only that colony stops; other colonies keep spawning their own affordable work.
 * (Legacy's single global stop would freeze the whole empire on one colony's expensive request.)
 *
 * The stop is for "can't pay yet, will after a refill." A body that costs more than the room's full
 * energyCapacity can *never* be paid for, so it is skipped instead — stopping on it would freeze the
 * colony's cheaper work forever waiting for a refill that can't reach it.
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

  // Colonies that hit a request they had a free spawn for but could not afford. Their remaining
  // (lower-priority, cheaper) requests are withheld for the tick rather than spawned in place of the
  // expensive one — the livelock guard. Scoped per colony so one colony's expensive request never
  // freezes another's affordable work (see the class docstring).
  const stopped = new Set<string>();

  const out: Intent[] = [];
  for (const request of requests) {
    const choice = pickPurse(request, purses, roomDistance, stopped);
    if (choice.stop) stopped.add(choice.stop);
    if (!choice.purse) continue; // nowhere can spawn this right now — re-derived next tick
    const slot = choice.purse.idle.shift()!; // pickPurse guarantees one
    out.push({ kind: "spawn", spawn: slot.id, body: request.body, memory: request.memory });
    choice.purse.budget -= bodyCost(request.body);
  }
  return out;
}

// The outcome of routing one request: the purse to spend from (if any), and the colony to stop (if
// the request's own funding colony had a free spawn but could not afford the body). The two are
// independent — a request can route nowhere without stopping anyone (no idle spawn), or stop its
// home colony while routing nowhere (home has a spawn it can't pay for, and no pin lets it wander).
interface Choice {
  purse?: Purse;
  stop?: string;
}

// The colony that should spawn this request. Consumes nothing — the caller takes the slot only once
// committed. A colony already in `stopped` is treated as unable to serve, so its cheaper requests
// never overtake the expensive one that stopped it.
function pickPurse(
  request: CreepRequest,
  purses: Map<string, Purse>,
  roomDistance: RoomDistance,
  stopped: ReadonlySet<string>
): Choice {
  const cost = bodyCost(request.body);
  const hasSpawn = (p: Purse | undefined): p is Purse => !!p && !stopped.has(p.room) && p.idle.length > 0;
  const canServe = (p: Purse | undefined): p is Purse => hasSpawn(p) && p.budget >= cost;
  // The colony to stop when `p` is the one that fell short: it has a free spawn but not the budget,
  // so its own cheaper demand must wait rather than leapfrog this request. Two cases stop nothing —
  // the request is skipped, not waited on — and both fall through to `undefined`:
  //   - no idle spawn: the request simply found no home there this tick.
  //   - cost above the room's full capacity: a refill can never reach it, so waiting would freeze the
  //     colony's cheaper work forever. Skip it and let the affordable requests behind it through.
  const stopRoom = (p: Purse | undefined): string | undefined =>
    hasSpawn(p) && cost <= p.capacity ? p.room : undefined;

  // Manual pin: spawn here or not at all. A pinned room that cannot pay waits rather than leaking
  // the creep to another colony — the request is deliberately room-specific. If it has a free spawn
  // but can't afford the body, it stops: a cheaper pinned request must not jump ahead of it.
  if (request.spawnRoom) {
    const pinned = purses.get(request.spawnRoom);
    return canServe(pinned) ? { purse: pinned } : { stop: stopRoom(pinned) };
  }

  // The target room first — a creep is cheapest to spawn where it is needed (no cross-room walk).
  const target = purses.get(request.targetRoom);
  if (canServe(target)) return { purse: target };

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
  if (best) return { purse: best };

  // Nowhere can pay. Stop the request's home colony if it is the one that fell short — so its own
  // cheaper demand waits for the refill instead of leapfrogging the expensive request in place.
  return { stop: stopRoom(target) };
}
