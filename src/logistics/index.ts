// planLogistics: the one per-tick entry point Logistics.intents() calls. Wires graph + allocate +
// reserved-folding — thin by design, since the interesting logic already lives in graph.ts/allocate.ts.

import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import { allocate, emptyReserved, refKey, type ReservedAmounts } from "./allocate";
import { consumers, providers } from "./graph";
import type { LogisticsTask } from "./types";

export interface LogisticsPlan {
  assignments: Record<Id<Creep>, LogisticsTask>; // this tick's intended task per idle/reassignable creep
}

/** Idle = no in-flight task to finish; everyone else's current+next feeds `reserved` instead. */
function isIdle(creep: SnapCreep): boolean {
  return creep.memory.logistics?.current === undefined;
}

// Folds every creep's current+next task into reserved amounts so a fresh allocation this tick can
// never double-book a provider/consumer a mid-task creep already claimed — generalizes targets.ts's
// claimCounts() from "count of creeps pointed at X" to "amount of resource already spoken for at X".
function foldReserved(creeps: readonly SnapCreep[]): ReservedAmounts {
  const reserved = emptyReserved();
  for (const creep of creeps) {
    for (const task of [creep.memory.logistics?.current, creep.memory.logistics?.next]) {
      if (!task) continue;
      if (task.from) reserved.providers[refKey(task.from)] = (reserved.providers[refKey(task.from)] ?? 0) + task.amount;
      if (task.to) reserved.consumers[refKey(task.to)] = (reserved.consumers[refKey(task.to)] ?? 0) + task.amount;
    }
  }
  return reserved;
}

export function planLogistics(colony: ColonySnapshot): LogisticsPlan {
  const transportCreeps = colony.creeps.filter(c => c.role === "transport");
  const idle = transportCreeps.filter(isIdle);
  if (idle.length === 0) return { assignments: {} };

  const reserved = foldReserved(transportCreeps);
  const assignments = allocate(providers(colony), consumers(colony), idle, reserved);
  return { assignments };
}
