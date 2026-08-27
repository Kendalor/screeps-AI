// Spawn arbiter: cross-colony routing since a request can be filled by any spawn-capable colony, not just its own room.
// Pure: reads colony snapshots, returns spawn intents; room distance is injected so this stays unit-testable.

import { bodyCost } from "../spawn/body";
import type { Colony } from "../colony";
import type { Intent } from "../intents/types";
import type { CreepRequest } from "../spawn/request";
import { log } from "../lib/log";

// Injected room-grid distance (Game.map.getRoomLinearDistance) so tests need no Game.
export type RoomDistance = (a: string, b: string) => number;

// Injected live storage+terminal stock lookup (gh #61 epic follow-up) so tests need no Game — mirrors
// RoomDistance's own injection style. The real caller (kernel/tick.ts) wires this to
// `Game.rooms[room]?.storage?.store.getUsedCapacity(resource) ?? 0 + the same for terminal`, the same
// stock definition empire/logistics.ts's stockOf already uses for empire-wide redistribution. Defaults to
// "always enough" so every existing call site (none of which exercises a boosted request) is unaffected.
export type BoostStockOf = (room: string, resource: ResourceConstant) => number;
const ALWAYS_ENOUGH: BoostStockOf = () => Infinity;

/**
 * A boosted request (CreepRequest.boostNeeds, set by SingleTargetFlagOperation.desiredCreeps once a flag
 * resolves a boost tier) is only ready to spawn once every compound it'll need is ALREADY sitting in the
 * spawning colony's storage+terminal (`request.spawnRoom` — always set for a boosted request, pinned to
 * whichever colony hosts the labs; see that field's own doc). An ordinary, un-boosted request (no
 * `boostNeeds` at all — the overwhelming majority) is always ready; nothing here changes for it.
 *
 * Why this matters: without this gate, a boosted creep spawns the instant it's merely AFFORDABLE (body
 * cost within budget), regardless of whether its boost compound has even arrived yet — confirmed live via
 * integration testing, this is exactly what let a demolisher finish spawning and then sit fully idle for
 * hundreds of ticks (once as long as ~500) waiting on a compound that a cross-colony transfer hadn't
 * delivered yet, burning a large fraction of the creep's own 1500-tick lifetime before it could even start
 * its job. Delaying the SPAWN itself until the compound is already available means that lifetime only
 * starts ticking once the creep can actually go to work.
 */
export function boostCompoundsReady(request: CreepRequest, boostStockOf: BoostStockOf): boolean {
  if (!request.boostNeeds) return true;
  const room = request.spawnRoom ?? request.targetRoom;
  for (const [resource, amount] of Object.entries(request.boostNeeds) as [ResourceConstant, number | undefined][]) {
    if (amount == null || amount <= 0) continue;
    if (boostStockOf(room, resource) < amount) return false;
  }
  return true;
}

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
 * Collect every colony's demand, sort by priority, and route each request to a spawn (nearest affordable
 * colony within maxSpawnRange if set, or a pinned spawnRoom).
 * A colony that can't afford its top request stops for the tick rather than letting a cheaper request leapfrog it, but other colonies are unaffected.
 */
export function planSpawning(colonies: Colony[], roomDistance: RoomDistance, boostStockOf: BoostStockOf = ALWAYS_ENOUGH): Intent[] {
  const requests = colonies
    .flatMap(c => c.requests())
    .sort((a, b) => b.priority - a.priority);
  if (requests.length === 0) return [];

  log.info(
    `spawn queue: ${requests.map(r => `${r.memory.role}(${r.priority})@${r.targetRoom}`).join(", ")}`
  );

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
    // Skipped, not stopped: an unready boosted request must not block its colony's OTHER, lower-priority
    // (but actually spawnable) requests the way an unaffordable one does (see stopped's own doc) — it
    // simply reappears next pass, unaffected, once desiredCreeps() re-emits it (see boostCompoundsReady's
    // own doc for why this gate exists at all).
    if (!boostCompoundsReady(request, boostStockOf)) continue;
    const choice = pickPurse(request, purses, roomDistance, stopped);
    if (choice.stop) stopped.add(choice.stop);
    if (!choice.purse) continue; // nowhere can spawn this right now
    const slot = choice.purse.idle.shift()!; // pickPurse guarantees one
    log.info(`spawning ${request.memory.role}(${request.priority})@${request.targetRoom} from ${choice.purse.room}`);
    // A creep needed in a room other than where it spawns (a remote miner) carries that room as its
    // permanent destination, so moveToRoom walks it there before it works. Local creeps get no targetRoom.
    const memory =
      request.targetRoom !== choice.purse.room ? { ...request.memory, targetRoom: request.targetRoom } : request.memory;
    out.push({ kind: "spawn", spawn: slot.id, body: request.body, memory });
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

  // Otherwise the nearest colony that can serve it. Eligibility (which colonies are candidates, and
  // which one gets stopped if none can pay right now) is judged against full capacity, not today's
  // available energy — a colony that could eventually afford this is still worth waiting on/searching
  // from, same reasoning as stopRoom above. Actually spending still requires real budget (canServe).
  let best: Purse | undefined;
  let bestDist = Infinity;
  let bestEligible: Purse | undefined; // nearest capacity-eligible purse, for the stop fallback below
  let bestEligibleDist = Infinity;
  for (const purse of purses.values()) {
    if (!hasSpawn(purse) || cost > purse.capacity) continue;
    const d = roomDistance(request.targetRoom, purse.room);
    if (request.maxSpawnRange !== undefined && d > request.maxSpawnRange) continue;
    if (d < bestEligibleDist) {
      bestEligibleDist = d;
      bestEligible = purse;
    }
    if (purse.budget < cost) continue;
    if (d < bestDist) {
      bestDist = d;
      best = purse;
    }
  }
  if (best) return { purse: best };

  // Nowhere can pay right now — stop the nearest colony that could eventually afford it (in range,
  // within capacity), falling back to the home/target room if none qualify.
  return { stop: bestEligible ? bestEligible.room : stopRoom(target) };
}
