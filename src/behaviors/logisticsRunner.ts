// Executes a "transport" creep's current logistics task: resolve its NodeRef to a live object, then
// act via the same resolved-target shims interpreter.ts's step table uses (behaviors/actions.ts) — no
// TargetSpec involved, since planLogistics already picked a concrete target.
//
// Does NOT call planLogistics itself: that already ran once per tick inside Logistics.intents() (tier
// 1, before "creeps") and its output landed in memory.logistics via the assignLogisticsTask intent by
// the time this runs — see kernel/tick.ts's SYSTEMS order.
//
// gh #53 cutover status: runTransport (and everything above it that exists only to support it —
// advanceOrPark, advanceOrTopOff, findLiveTopoff, topoffTask, resolveNode, isTaskDone, providerEmpty,
// consumerFull, homeRoomWaypoint) is now DEAD CODE — no live call path reaches it any more. Supply (the
// last live caller, via empire/creeps.ts) is driven by behaviors/supplyTaskRunner.ts's runSupplyTask
// instead, following Transport's own gh #52 cutover. parkNearBunker stays live — both new task runners
// still call it directly from empire/creeps.ts when a creep has nothing assigned. Left in place rather
// than deleted here, matching gh #52's own precedent for transportProviders/consumers/storageOverflow:
// full deletion of this file's dead half (and planLogistics/assignLogisticsTask/memory.logistics, all
// dead for the same reason — see logistics/index.ts's header) is gh #55's job, once Steward (#54) also
// cuts over and the whole old system can be removed in one pass.

import type { LogisticsTask, NodeRef } from "../logistics/types";
import { log } from "../lib/log";
import { wrapFn } from "../lib/profiler";
import { pickTopoff, topoffRange, type TopoffCandidate } from "../logistics/topoff";
import { transferTo, withdrawOrPickup } from "./actions";
import { dangerAvoidanceOptions } from "./interpreter";
import { stepOffRoad } from "./roadAvoidance";

const PARK_RADIUS = 3; // "near the bunker" — anywhere within this range of the anchor counts as parked
const PARK_SPREAD = 2; // per-creep offset off the anchor so idle creeps fan out instead of stacking

// Linear room distance from the creep's current room to its home room (0 while already home), the cheap
// proxy for "how much of the trip is still ahead" — see logistics/topoff.ts's TOPOFF_RANGE_PER_ROOM doc.
// Falls back to 0 (never widens the range) if Game.map isn't available, matching this file's existing
// defensive style for optional globals (parkNearBunker/homeRoomWaypoint's `typeof Memory` checks).
function roomsFromHome(creep: Creep): number {
  if (creep.room.name === creep.memory.home) return 0;
  if (typeof Game === "undefined" || !Game.map?.getRoomLinearDistance) return 0;
  return Game.map.getRoomLinearDistance(creep.room.name, creep.memory.home);
}

// A stable per-creep hash so a given creep always parks on the same spread-out spot rather than
// jittering every tick — cheap FNV-ish fold over the name.
function nameHash(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h = (h ^ name.charCodeAt(i)) * 16777619;
  }
  return h >>> 0;
}

// Idle with nothing to carry and nowhere to deliver: loiter near the bunker anchor (a spread-out spot,
// not exactly on it) so a parked transport creep isn't sitting on a source/road blocking traffic, and
// is central for whichever consumer appears next. No-op until building has recorded an anchor.
export function parkNearBunker(creep: Creep): void {
  const anchor = typeof Memory !== "undefined" ? Memory.colonies?.[creep.memory.home]?.anchor : undefined;
  if (!anchor) return;

  if (creep.pos.getRangeTo(anchor.x, anchor.y) <= PARK_RADIUS) {
    // Already "close enough" to stay put — but a road tile right by the bunker can be the sole approach
    // to an adjacent structure (confirmed live: a parked supply creep squatting on the only tile next to
    // an extension permanently blocked a sibling's deliveries, since Traveler's cost matrix ignores
    // creep occupancy and never repaths around one). Cede it the same way a stationary
    // builder/upgrader does.
    stepOffRoad(creep, new RoomPosition(anchor.x, anchor.y, creep.room.name), PARK_RADIUS);
    return;
  }

  const h = nameHash(creep.name);
  const dx = (h % (2 * PARK_SPREAD + 1)) - PARK_SPREAD;
  const dy = (Math.floor(h / (2 * PARK_SPREAD + 1)) % (2 * PARK_SPREAD + 1)) - PARK_SPREAD;
  creep.travelTo(new RoomPosition(anchor.x + dx, anchor.y + dy, creep.room.name));
}

// After a withdraw/pickup, has the source got nothing left of this resource to give? A dropped pile
// exposes `.amount`; a store-bearing structure/tombstone/ruin exposes `.store`. Either at zero means this
// pickup leg is spent and the creep should flow on to the next leg rather than retry an empty source.
function providerEmpty(target: RoomObject, resource: ResourceConstant): boolean {
  const asDrop = target as { amount?: number };
  if (typeof asDrop.amount === "number") return asDrop.amount <= 0;
  const asStore = target as { store?: { getUsedCapacity?(r: ResourceConstant): number | null } };
  if (typeof asStore.store?.getUsedCapacity === "function") return (asStore.store.getUsedCapacity(resource) ?? 0) <= 0;
  return false;
}

// A deliver target with no room left for this resource: a store-bearing structure/creep at capacity.
// Objects without a queryable store (shouldn't be a deliver target) count as "not full" so the normal
// transfer path handles them. Mirrors providerEmpty on the sink side.
function consumerFull(target: RoomObject, resource: ResourceConstant): boolean {
  const asStore = target as { store?: { getFreeCapacity?(r: ResourceConstant): number | null } };
  if (typeof asStore.store?.getFreeCapacity === "function") return (asStore.store.getFreeCapacity(resource) ?? 0) <= 0;
  return false;
}

// Where a travelHome task heads: the bunker anchor once one's been recorded, else the room center — the
// exact spot doesn't matter, Traveler only needs a target in the home room to route the cross-room path.
function homeRoomWaypoint(creep: Creep): RoomPosition {
  const anchor = typeof Memory !== "undefined" ? Memory.colonies?.[creep.memory.home]?.anchor : undefined;
  return anchor ? new RoomPosition(anchor.x, anchor.y, creep.memory.home) : new RoomPosition(25, 25, creep.memory.home);
}

function resolveNode(creep: Creep, ref: NodeRef): RoomObject | null {
  switch (ref.kind) {
    case "structure":
      return Game.getObjectById(ref.id) as RoomObject | null;
    case "dropped":
      return Game.getObjectById(ref.id) as RoomObject | null;
    case "tombstone":
      return Game.getObjectById(ref.id) as RoomObject | null;
    case "ruin":
      return Game.getObjectById(ref.id) as RoomObject | null;
    case "creep":
      return Game.getObjectById(ref.id) as RoomObject | null;
    case "spawnSystem": {
      // The graph only knows the aggregate demand; resolve to the nearest structure that can still
      // take energy right now, mirroring hauler.ts's own spawn/extension "any" pool.
      const targets = creep.room.find(FIND_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION) &&
          (s as StructureSpawn | StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0
      });
      return creep.pos.findClosestByPath(targets) ?? null;
    }
  }
}

// A task is done once it can no longer make progress *before acting this tick*: a pickup with no free
// capacity left, or a deliver with nothing left to give. Mirrors interpreter.ts's isComplete for
// gather/spend steps. NOTE: a deliver is ALSO completed the instant its transfer executes in range —
// see runTransport below — so a creep whose committed amount lands in a nearly-full consumer (e.g. a
// builder with only a few free capacity) is released back to reallocation still loaded, rather than
// babysitting that consumer and dribbling in energy while spawn/extensions sit empty behind it.
function isTaskDone(creep: Creep, task: LogisticsTask): boolean {
  if (task.kind === "pickup") return creep.store.getFreeCapacity(task.resource) === 0;
  return creep.store.getUsedCapacity(task.resource) === 0;
}

// Advance to the current leg's nested follow-up (the next link in the pickup->...->deliver chain);
// park near the bunker when nothing remains so an idle creep loiters centrally instead of blocking a
// source/road wherever it happened to finish.
function advanceOrPark(creep: Creep): void {
  const next = creep.memory.logistics?.current?.next;
  creep.memory.logistics = next ? { current: next } : {};
  if (!next) parkNearBunker(creep);
}

// Gathers every worthwhile-or-not candidate within `range` of the creep's current position (right where
// the just-drained provider was) and hands the pick to logistics/topoff.ts's pure pickTopoff — the only
// Game.* dependency this detour has left is these findInRange scans. Live scan, not snapshot/allocate-
// driven: this exists specifically to catch the case allocate.ts's plan-once-when-idle model can't — a
// provider that looked fine when planLogistics ran a tick or more ago but got drained by something
// outside the logistics system (a sweep pickup, a builder self-feeding, another creep entirely) by the
// time this creep actually arrived, while a sibling provider sits right next to it (e.g. a miner's
// container plus its overflow drop pile on/beside the same tile).
//
// This runs unconditionally on EVERY travelHome tick with spare capacity (confirmed live 2026-08-13 CPU
// profiling: transport:runTransport was the single most expensive per-call creep function), so a
// PathFinder search here is paid every tick of a whole cross-room trip, not once — pickTopoff's
// straight-line-range ranking (not findClosestByPath) is deliberate for the same reason; see its own doc.
function findLiveTopoff(creep: Creep, exclude: Id<_HasId> | undefined, range: number): TopoffCandidate | undefined {
  const containers: TopoffCandidate[] = creep.pos
    .findInRange(FIND_STRUCTURES, range, { filter: s => s.structureType === STRUCTURE_CONTAINER })
    .map(s => s as StructureContainer)
    .map(c => ({ ref: { kind: "structure", id: c.id as Id<AnyStoreStructure> }, pos: c.pos, amount: c.store.getUsedCapacity(RESOURCE_ENERGY) }));

  const drops: TopoffCandidate[] = creep.pos
    .findInRange(FIND_DROPPED_RESOURCES, range, { filter: d => d.resourceType === RESOURCE_ENERGY })
    .map(d => ({ ref: { kind: "dropped", id: d.id }, pos: d.pos, amount: d.amount }));
  const tombs: TopoffCandidate[] = creep.pos
    .findInRange(FIND_TOMBSTONES, range)
    .map(t => ({ ref: { kind: "tombstone", id: t.id }, pos: t.pos, amount: t.store.getUsedCapacity(RESOURCE_ENERGY) }));
  const ruins: TopoffCandidate[] = creep.pos
    .findInRange(FIND_RUINS, range)
    .map(r => ({ ref: { kind: "ruin", id: r.id }, pos: r.pos, amount: r.store.getUsedCapacity(RESOURCE_ENERGY) }));

  return pickTopoff(creep.pos, containers, [...drops, ...tombs, ...ruins], exclude);
}

// Builds a pickup task for a live-found topoff candidate, capped to the creep's free capacity, resuming
// `resumeWith` (the chain/task to fall back into) once that pickup completes. Shared by advanceOrTopOff
// (splices ahead of a pickup chain's `next`) and the travelHome branch (resumes travelHome itself after
// the detour) — both are "grab this first, then continue what I was already doing."
function topoffTask(creep: Creep, topoff: TopoffCandidate, resumeWith: LogisticsTask | undefined): LogisticsTask {
  const amount = Math.min(creep.store.getFreeCapacity(RESOURCE_ENERGY), topoff.amount);
  return { kind: "pickup", from: topoff.ref, resource: RESOURCE_ENERGY, amount, next: resumeWith };
}

// A pickup leg that came up short (its provider was drained, whether by this withdraw or by something
// else before the creep arrived) but left the creep with spare capacity: rather than falling straight
// to advanceOrPark — which, with no `next` queued, would leave the creep idle far from home and hand it
// a travelHome task next tick on however little it's carrying (see allocate.ts's byLoadedFirst) — check
// nearby (see topoffRange) for another worthwhile pickup first and splice it in ahead of whatever chain
// remains. Only meaningful outside the home room: a home-room shortfall already has plenty of
// alternative sinks/providers and gets re-planned properly next tick anyway once idle.
function advanceOrTopOff(creep: Creep, exhaustedId: Id<_HasId> | undefined): void {
  const remainingChain = creep.memory.logistics?.current?.next;
  if (creep.room.name !== creep.memory.home && creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    const topoff = findLiveTopoff(creep, exhaustedId, topoffRange(roomsFromHome(creep)));
    if (topoff) {
      creep.memory.logistics = { current: topoffTask(creep, topoff, remainingChain) };
      return;
    }
  }
  advanceOrPark(creep);
}

export const runTransport = wrapFn(function runTransport(creep: Creep): void {
  const task = creep.memory.logistics?.current;
  if (!task) {
    // Nothing assigned this tick — planLogistics runs upstream, not from here. Loiter near the bunker.
    log.debugCreep(creep.name, "no logistics task assigned — parking near bunker");
    parkNearBunker(creep);
    return;
  }
  log.debugCreep(creep.name, `task=${task.kind} resource=${task.resource} carrying=${creep.store.getUsedCapacity()}`);

  // A loaded creep still out in a remote room: just head for the home room. No `from`/`to` to resolve —
  // the deliver consumer is deliberately left unpicked until a later tick finds it idle back home (see
  // allocate.ts), so a spawn/extension reservation never spans the whole cross-room trip.
  if (task.kind === "travelHome") {
    if (creep.room.name === creep.memory.home) {
      advanceOrPark(creep);
      return;
    }
    // Detour for a nearby topoff before continuing (see topoffRange/findLiveTopoff): allocate.ts commits
    // to travelHome the instant it sees a loaded, idle, off-home creep, with no minimum load and no live
    // check of what's around it (it's a pure snapshot planner, can't do that check itself). Re-checked
    // every tick while still travelling, not just once at assignment, so a creep also picks up whatever
    // it happens to walk past en route, not only what was nearby the tick it went idle.
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      const topoff = findLiveTopoff(creep, undefined, topoffRange(roomsFromHome(creep)));
      if (topoff) {
        creep.memory.logistics = { current: topoffTask(creep, topoff, task) };
        return;
      }
    }
    // Danger-aware the same way moveToRoom's avoidDanger step is (see dangerAvoidanceOptions's doc):
    // this is a genuine cross-room trip, unlike the withdraw/deliver legs below which are usually a
    // same-room walk to an already-resolved target — a plain travelTo here had no route awareness at
    // all, so a remote hauler could path straight through a keeper guardian's patrol radius and get
    // batted back and forth by fleeThreat forever instead of detouring around it.
    creep.travelTo(homeRoomWaypoint(creep), dangerAvoidanceOptions(creep.memory.home, creep.memory.home));
    return;
  }

  if (isTaskDone(creep, task)) {
    advanceOrPark(creep);
    return;
  }

  const ref = task.kind === "pickup" ? task.from : task.to;
  if (!ref) {
    advanceOrPark(creep);
    return;
  }

  const target = resolveNode(creep, ref);
  if (!target) {
    // Target vanished (drained by someone else, picked up, etc) — drop the task so next tick's
    // planLogistics assigns fresh rather than retrying a dead reference forever.
    advanceOrPark(creep);
    return;
  }

  // Only the home-room-vs-not distinction matters here (not "is the target's room actually risky") —
  // dangerCostMatrix/dangerRouteCallback are no-ops in a room with nothing dangerous in it, so passing
  // this unconditionally for any off-home leg costs nothing and simply gives Traveler a chance to route
  // around a keeper lair/hostile it would otherwise walk straight through (see dangerAvoidanceOptions).
  const travelOptions = creep.room.name === creep.memory.home && target.pos.roomName === creep.memory.home
    ? undefined
    : dangerAvoidanceOptions(creep.memory.home, target.pos.roomName);

  if (task.kind === "pickup") {
    const result = withdrawOrPickup(creep, target, task.resource, true, travelOptions);
    // Advance once this pickup can make no further progress here: the creep filled up, OR the provider
    // is now empty (a partial container/pile that didn't fill the creep). Without the drained-provider
    // check a chain would re-withdraw from an empty source forever, since it's not idle and so never
    // re-planned. Only after acting in range (didAct) — merely traveling toward it isn't progress.
    if (result.didAct && creep.store.getFreeCapacity(task.resource) === 0) {
      advanceOrPark(creep);
    } else if (result.didAct && providerEmpty(target, task.resource)) {
      // Drained but still has room: try a live top-off in this room (see advanceOrTopOff) before
      // falling through to the queued chain / going idle.
      advanceOrTopOff(creep, (target as unknown as { id: Id<_HasId> }).id);
    }
    return;
  }

  // Target already full on arrival (another creep, a spawn, or a tower drew from the pool since the
  // allocator picked it a tick ago): skip straight to the next leg rather than travel to — or babysit —
  // a sink with no room. This is what makes the deliver chain robust to a target going stale between
  // planning and execution (the per-structure trade-off for reserving specific extensions up front).
  if (consumerFull(target, task.resource)) {
    advanceOrPark(creep);
    return;
  }

  // A deliver is fulfilled the tick its transfer actually executes (in range): the task named an
  // `amount` to move to `to`, and one transfer moves min(carried, target free capacity) into it — so
  // the ask is complete once that transfer fires, whether or not the creep is now empty. Completing
  // here (rather than only when the creep empties) is what stops a still-loaded creep from following a
  // slow-draining builder/upgrader forever, AND lets a multi-dropoff chain flow sink->sink: each leg
  // fires once and advances to the next. `didAct` is true only when it acted in range; false means it
  // merely traveled toward the target this tick.
  const result = transferTo(creep, target, task.resource, true, travelOptions);
  if (result.didAct) advanceOrPark(creep);
}, "transport:runTransport");
