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
// A creep's `current` is the head of a chain that mixes pickup and deliver legs (pickup->pickup->...->
// deliver->deliver->...). The reservation rule is per-leg-kind:
//   - each PICKUP leg reserves its `from` PROVIDER by that leg's amount — every source in the chain is
//     still to be drawn from, so an idle creep must not be sent to one this chain plans to empty;
//   - each DELIVER leg reserves its `to` CONSUMER by that leg's amount — every sink the trip will fill
//     is still open work nobody else should be dispatched to.
// A pickup leg's own `to` (only a foldReserved-free head-pointer hint the allocator sets) is IGNORED
// here — reserving off it would double-count the consumer the deliver legs already reserve exactly.
function foldReserved(creeps: readonly SnapCreep[]): ReservedAmounts {
  const reserved = emptyReserved();
  for (const creep of creeps) {
    for (let leg = creep.memory.logistics?.current; leg; leg = leg.next) {
      if (leg.kind === "pickup" && leg.from) {
        reserved.providers[refKey(leg.from)] = (reserved.providers[refKey(leg.from)] ?? 0) + leg.amount;
      } else if (leg.kind === "deliver" && leg.to) {
        reserved.consumers[refKey(leg.to)] = (reserved.consumers[refKey(leg.to)] ?? 0) + leg.amount;
      }
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
