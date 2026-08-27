// Runs a Supply-role creep's self-registered spawn/extension/tower top-off (gh #50, ADR 0008): picks the
// best SupplyRequest via logistics/supplyRegister.ts's tier-first-then-nearest selection (no rate math —
// that's Transport's/Steward's pool, not this one) and drives an idle creep onto it via the same
// Task/fork/parent chain primitive gh #45 built (logistics/task.ts), reusing behaviors/actions.ts's
// withdraw/transfer leaves exactly as logisticsTaskRunner.ts does. Live as of gh #53: empire/creeps.ts's
// dispatchCreep sends every role==="supply" creep here each tick (replacing the old graph.ts/allocate.ts/
// logisticsRunner.ts path — that whole old system is deleted, gh #55), mirroring Transport's own gh #52
// cutover onto transportTaskRunner.ts. Still exercised directly by the test-only __runSupplyTask console
// hook (testHooks.ts) too, unchanged from gh #50.

import { registerBoostLabRequests, registerSupplyRequests, pickSupplyRequest } from "../logistics/supplyRegister";
import { buildTargetedBy } from "../logistics/targeted";
import { fork, persistTask, resolveTask, type Task } from "../logistics/task";
import { transferTo, withdrawOrPickup } from "./actions";

/** The colony's (up to 3) live boost lab objects, resolved from ColonyMemory.boostLabIds — mirrors
 * transportTaskRunner.ts's own boostLabs() exactly (same persisted ids, same "absent until Colony.labs()
 * has reserved 3 labs" contract); duplicated locally rather than shared since it's a 3-line Memory ->
 * Game.* lookup, not worth a cross-module import for. */
function boostLabs(home: string): (StructureLab | undefined)[] {
  const ids = Memory.colonies[home]?.boostLabIds;
  return ids ? ids.map(id => Game.getObjectById(id) ?? undefined) : [];
}

// A withdraw leg is complete once the creep can't carry more; a transfer leg once it has nothing left to
// give — mirrors logisticsTaskRunner.ts's isTaskComplete exactly (same Task shape, same completion rule).
function isTaskComplete(creep: Creep, task: Task): boolean {
  if (task.kind === "withdraw") return creep.store.getFreeCapacity(task.resource) === 0;
  return creep.store.getUsedCapacity(task.resource) === 0;
}

function targetExhausted(task: Task): boolean {
  const target = task.target as unknown as RoomObject;
  if (task.kind === "withdraw") {
    const asDrop = target as { amount?: number };
    if (typeof asDrop.amount === "number") return asDrop.amount <= 0;
    const asStore = target as { store?: { getUsedCapacity?(r: ResourceConstant): number | null } };
    if (typeof asStore.store?.getUsedCapacity === "function") return (asStore.store.getUsedCapacity(task.resource) ?? 0) <= 0;
    return false;
  }
  const asStore = target as { store?: { getFreeCapacity?(r: ResourceConstant): number | null } };
  if (typeof asStore.store?.getFreeCapacity === "function") return (asStore.store.getFreeCapacity(task.resource) ?? 0) <= 0;
  return false;
}

function act(creep: Creep, task: Task): { didAct: boolean } {
  const target = task.target as unknown as RoomObject;
  return task.kind === "withdraw" ? withdrawOrPickup(creep, target, task.resource) : transferTo(creep, target, task.resource);
}

/**
 * A creep with nothing to deliver yet: find the nearest live energy it can carry (storage/container/
 * dropped pile — anything with the resource, no tier logic here since this is the pickup leg, not
 * selection among sinks), same "any pile that has some" shape hauler.ts's own pickup fallback uses. Null
 * if nothing is found — a Supply creep with no energy anywhere to draw from simply waits.
 */
function findEnergySource(creep: Creep): (_HasId & { pos: RoomPosition }) | null {
  const withEnergy = creep.room
    .find(FIND_STRUCTURES, {
      filter: s =>
        (s.structureType === STRUCTURE_STORAGE || s.structureType === STRUCTURE_CONTAINER) &&
        (s as AnyStoreStructure).store.getUsedCapacity(RESOURCE_ENERGY) > 0
    })
    .sort((a, b) => creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b))[0] as AnyStoreStructure | undefined;
  if (withEnergy) return withEnergy;

  const pile = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, { filter: r => r.resourceType === RESOURCE_ENERGY });
  return pile ?? null;
}

/**
 * Builds a fresh withdraw -> transfer chain for an idle Supply creep: registerSupplyRequests() reads the
 * room's live spawn/extension/tower state, registerBoostLabRequests() adds every reserved boost lab's own
 * energy want, unconditionally (see supplyRegister.ts's header for why that lives here rather than
 * Transport's pool, and why it isn't gated on an active claim), pickSupplyRequest() picks
 * tier-first-then-nearest across both — discounted by `otherSupplyCreeps`' already-persisted tasks
 * (targeted.ts's buildTargetedBy, same mechanism as Transport's own gh #49 discount) so two live Supply
 * creeps (quota is 2 as of operations/supply.ts) don't both pile onto the same nearest starved extension
 * while a different one sits unfilled — and the pickup leg draws from whatever live energy is nearest.
 * Undefined when the creep already carries energy (nothing to withdraw) or no request/source exists.
 */
export function planSupplyTask(creep: Creep, otherSupplyCreeps: readonly Creep[] = []): Task | undefined {
  const home = creep.memory.home;
  const requests = [...registerSupplyRequests(creep.room), ...registerBoostLabRequests(boostLabs(home))];
  const targetedBy = buildTargetedBy(otherSupplyCreeps);
  const request = pickSupplyRequest(requests, creep.pos, undefined, targetedBy, creep);
  if (!request) return undefined;

  const deliver: Task = { kind: "transfer", target: request.target, resource: RESOURCE_ENERGY };
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) return deliver;

  const source = findEnergySource(creep);
  if (!source) return undefined;
  return fork({ kind: "withdraw", target: source, resource: RESOURCE_ENERGY }, deliver);
}

/**
 * Runs `creep`'s current persisted Supply task one tick, planning a fresh one when idle.
 * `otherSupplyCreeps` should be every OTHER live Supply creep in the same colony (empire/creeps.ts's
 * dispatchCreep builds this the same way it already does for Transport's own siblings) — see
 * planSupplyTask's own doc for why it's threaded through rather than defaulting to empty in real dispatch.
 */
export function runSupplyTask(creep: Creep, otherSupplyCreeps: readonly Creep[] = []): void {
  let task: Task | undefined;
  if (creep.memory.logisticsTask) {
    task = resolveTask(creep.memory.logisticsTask) ?? undefined;
    if (!task) creep.memory.logisticsTask = undefined; // dead reference — drop and replan below
  }
  if (!task) {
    task = planSupplyTask(creep, otherSupplyCreeps);
    if (!task) return; // nothing to do this tick
  }

  const result = act(creep, task);
  if (result.didAct && (isTaskComplete(creep, task) || targetExhausted(task))) {
    creep.memory.logisticsTask = task.parent ? persistTask(task.parent) : undefined;
  } else {
    creep.memory.logisticsTask = persistTask(task);
  }
}
