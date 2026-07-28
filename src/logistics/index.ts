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

// Folds every creep's in-flight task into reserved amounts so a fresh allocation this tick can never
// double-book a provider/consumer a mid-task creep already claimed — generalizes targets.ts's
// claimCounts() from "count of creeps pointed at X" to "amount of resource already spoken for at X".
//
// Only `current` is folded, never `next`: a pickup's `current` already carries both its provider
// (`from`) and its destination consumer (`to`), so it reserves both legs of the round trip in one
// pass. The paired `next` deliver names that SAME energy and SAME consumer — folding it too would
// reserve the consumer twice and wrongly starve other idle creeps of it. When `next` is promoted to
// `current` on completion, it then folds normally as the sole remaining leg.
function foldReserved(creeps: readonly SnapCreep[]): ReservedAmounts {
  const reserved = emptyReserved();
  for (const creep of creeps) {
    const task = creep.memory.logistics?.current;
    if (!task) continue;
    if (task.from) reserved.providers[refKey(task.from)] = (reserved.providers[refKey(task.from)] ?? 0) + task.amount;
    if (task.to) reserved.consumers[refKey(task.to)] = (reserved.consumers[refKey(task.to)] ?? 0) + task.amount;
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
