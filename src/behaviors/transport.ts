// Executes a "transport" creep's current logistics task: resolve its NodeRef to a live object, then
// act via the same resolved-target shims interpreter.ts's step table uses (behaviors/actions.ts) — no
// TargetSpec involved, since planLogistics already picked a concrete target.
//
// Does NOT call planLogistics itself: that already ran once per tick inside Logistics.intents() (tier
// 1, before "creeps") and its output landed in memory.logistics via the assignLogisticsTask intent by
// the time this runs — see kernel/tick.ts's SYSTEMS order.

import type { LogisticsTask, NodeRef } from "../logistics/types";
import { log } from "../lib/log";
import { wrapFn } from "../lib/profiler";
import { transferTo, withdrawOrPickup } from "./actions";

const PARK_RADIUS = 3; // "near the bunker" — anywhere within this range of the anchor counts as parked
const PARK_SPREAD = 2; // per-creep offset off the anchor so idle creeps fan out instead of stacking

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
function parkNearBunker(creep: Creep): void {
  const anchor = typeof Memory !== "undefined" ? Memory.colonies?.[creep.memory.home]?.anchor : undefined;
  if (!anchor) return;

  if (creep.pos.getRangeTo(anchor.x, anchor.y) <= PARK_RADIUS) return; // close enough already

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
    creep.travelTo(homeRoomWaypoint(creep));
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

  if (task.kind === "pickup") {
    const result = withdrawOrPickup(creep, target, task.resource);
    // Advance once this pickup can make no further progress here: the creep filled up, OR the provider
    // is now empty (a partial container/pile that didn't fill the creep). Without the drained-provider
    // check a chain would re-withdraw from an empty source forever, since it's not idle and so never
    // re-planned. Only after acting in range (didAct) — merely traveling toward it isn't progress.
    if (result.didAct && (creep.store.getFreeCapacity(task.resource) === 0 || providerEmpty(target, task.resource))) {
      advanceOrPark(creep);
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
  const result = transferTo(creep, target, task.resource);
  if (result.didAct) advanceOrPark(creep);
}, "transport:runTransport");
