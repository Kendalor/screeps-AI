// Executes a creep's persisted logistics Task (gh #45's fork/parent chain), resolving CreepMemory.
// logisticsTask back to live objects only when acted on. Standalone: not called from any live role's
// step table yet — see logistics/task.ts's header.

import { persistTask, resolveTask, type Task } from "../logistics/task";
import { dangerAvoidanceOptions } from "./interpreter";
import { transferTo, withdrawOrPickup } from "./actions";

// A task is done once it can no longer make progress before acting this tick: a withdraw with no free
// capacity left, or a transfer with nothing left to give. Mirrors logisticsRunner.ts's isTaskDone.
// An amount-capped task (Task.amount, see its own doc) is a one-shot: "move exactly this much, once" —
// checked by the caller instead, since completion there only needs the tick's own act() result, not any
// store-capacity signal (a capped withdraw commonly leaves both the creep and the source with room to
// spare, which would otherwise never be read as complete).
function isTaskComplete(creep: Creep, task: Task): boolean {
  if (task.kind === "withdraw") return creep.store.getFreeCapacity(task.resource) === 0;
  return creep.store.getUsedCapacity(task.resource) === 0;
}

// A withdraw target with nothing left to give, or a transfer target with no room left — either means
// this leg is spent and re-acting on it every tick would never make progress. Mirrors logisticsRunner.ts's
// providerEmpty/consumerFull (see its own doc): a dropped pile exposes `.amount`, a store-bearing
// structure/tombstone/ruin exposes `.store`.
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
  // Danger-aware for any leg outside the creep's home room, same as logisticsRunner.ts's runTransport —
  // dangerCostMatrix/dangerRouteCallback are no-ops in a room with nothing dangerous in it, so this costs
  // nothing for a same-room leg and simply gives Traveler a chance to route around a keeper lair/hostile
  // it would otherwise walk straight through for a remote leg.
  const travelOptions =
    creep.room.name === creep.memory.home && target.pos.roomName === creep.memory.home
      ? undefined
      : dangerAvoidanceOptions(creep.memory.home, target.pos.roomName);
  return task.kind === "withdraw"
    ? withdrawOrPickup(creep, target, task.resource, true, travelOptions, task.amount)
    : transferTo(creep, target, task.resource, true, travelOptions, task.amount);
}

/** Runs `creep`'s current persisted task one tick: act (or travel), advance to `.parent` on completion. */
export function runLogisticsTask(creep: Creep): void {
  const persisted = creep.memory.logisticsTask;
  if (!persisted) return;

  // resolveTask doubles as the isValidTask check (see its own doc in logistics/task.ts).
  const task = resolveTask(persisted);
  if (!task) {
    // Target vanished — drop the task rather than retry a dead reference forever (see gh #45's AC).
    creep.memory.logisticsTask = undefined;
    return;
  }

  // Deliberately no pre-act completion shortcut here: checking isTaskComplete/targetExhausted BEFORE the
  // first act() would silently skip a freshly-assigned leg whenever the creep's carry already happened to
  // satisfy it (e.g. reassigned mid-route with leftover carry from a previous task) — the leg's action
  // would never run even once. Acting first and checking completion only afterward means a leg that's
  // already done gets exactly one (harmless, no-op) act() call before advancing, never zero.
  const result = act(creep, task);
  // An amount-capped leg (Task.amount) is a one-shot: any successful act already moved (up to) exactly
  // what it was meant to, so it's complete regardless of remaining creep/target capacity — see Task's own
  // doc for why isTaskComplete's store-capacity checks can't tell that on their own.
  if (result.didAct && (task.amount !== undefined || isTaskComplete(creep, task) || targetExhausted(task))) {
    creep.memory.logisticsTask = task.parent ? persistTask(task.parent) : undefined;
  }
}
