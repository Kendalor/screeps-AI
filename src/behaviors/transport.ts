// Executes a "transport" creep's current logistics task: resolve its NodeRef to a live object, then
// act via the same resolved-target shims interpreter.ts's step table uses (behaviors/actions.ts) — no
// TargetSpec involved, since planLogistics already picked a concrete target.
//
// Does NOT call planLogistics itself: that already ran once per tick inside Logistics.intents() (tier
// 1, before "creeps") and its output landed in memory.logistics via the assignLogisticsTask intent by
// the time this runs — see kernel/tick.ts's SYSTEMS order.

import type { LogisticsTask, NodeRef } from "../logistics/types";
import { transferTo, withdrawOrPickup } from "./actions";

function resolveNode(creep: Creep, ref: NodeRef): RoomObject | null {
  switch (ref.kind) {
    case "structure":
      return Game.getObjectById(ref.id) as RoomObject | null;
    case "dropped":
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

// A task is done once it can no longer make progress: a pickup with no free capacity left, or a
// deliver with nothing left to give. Mirrors interpreter.ts's isComplete for gather/spend steps.
function isTaskDone(creep: Creep, task: LogisticsTask): boolean {
  if (task.kind === "pickup") return creep.store.getFreeCapacity(task.resource) === 0;
  return creep.store.getUsedCapacity(task.resource) === 0;
}

export function runTransport(creep: Creep): void {
  const task = creep.memory.logistics?.current;
  if (!task) return; // nothing assigned yet this tick — planLogistics runs upstream, not from here

  if (isTaskDone(creep, task)) {
    creep.memory.logistics = { current: creep.memory.logistics?.next };
    return;
  }

  const ref = task.kind === "pickup" ? task.from : task.to;
  if (!ref) {
    creep.memory.logistics = { current: creep.memory.logistics?.next };
    return;
  }

  const target = resolveNode(creep, ref);
  if (!target) {
    // Target vanished (drained by someone else, picked up, etc) — drop the task so next tick's
    // planLogistics assigns fresh rather than retrying a dead reference forever.
    creep.memory.logistics = { current: creep.memory.logistics?.next };
    return;
  }

  if (task.kind === "pickup") {
    withdrawOrPickup(creep, target, task.resource);
  } else {
    transferTo(creep, target, task.resource);
  }
}
