// planLogistics: the one per-tick entry point Logistics.intents() calls. Plans Supply's fleet only
// (the spawn/tower topper, restricted to graph.ts's supplyProviders/supplyConsumers) — wires graph +
// allocate + reserved-folding for that one fleet, thin by design since the interesting logic lives in
// graph.ts/allocate.ts.
//
// gh #52 cutover: Transport no longer plans through this module. It used to plan both fleets in one
// coordinated pass so the two could never double-book the same node; Transport is now driven live by
// behaviors/transportTaskRunner.ts against the new LogisticsRequest/rate-ranking system instead (see that
// module's header) — Supply's old graph.ts/allocate.ts path here is untouched and still the live
// spawn/extension/tower fast path (Supply's own cutover is gh #53). The two systems can't double-book a
// node either: Supply's scope (spawnSystem/tower) and Transport's new pool's scope (everything else) are
// already disjoint by construction (see transportRegister.ts's header) the same way graph.ts's
// supplyProviders/supplyConsumers vs. transportProviders/consumers were.

import { buildCostMatrix } from "../construction/roadPathing";
import type { RoadCostMatrix } from "../lib/pathing";
import { wrapFn } from "../lib/profiler";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import { allocate, emptyReserved, refKey, type ReservedAmounts } from "./allocate";
import { supplyConsumers, supplyProviders } from "./graph";
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

/**
 * Supply's plan: a restricted view of the provider/consumer graph — spawn/extensions and towers only on
 * the sink side, never a remote-room pickup on the source side (see graph.ts's supplyProviders/
 * supplyConsumers). This is now the WHOLE of planLogistics (below) — see this module's header for why
 * Transport no longer plans here as of gh #52.
 */
function planSupply(colony: ColonySnapshot, costMatrix: RoadCostMatrix): LogisticsPlan {
  const supplyCreeps = colony.creeps.filter(c => c.role === "supply");
  const reserved = foldReserved(supplyCreeps);
  const idle = supplyCreeps.filter(isIdle);
  const assignments =
    idle.length === 0
      ? {}
      : allocate(supplyProviders(colony), supplyConsumers(colony), idle, reserved, null, costMatrix, colony.name);
  return { assignments };
}

export const planLogistics = wrapFn(function planLogistics(colony: ColonySnapshot): LogisticsPlan {
  // Built once per tick and reused across every idle creep's pickup search below — same terrain/
  // structure snapshot data the construction/roadPathing.ts road-planning callers already build a matrix from, so
  // this is no extra Game access, just the same cost matrix asked for repeatedly in one place instead
  // of once per creep.
  const costMatrix = buildCostMatrix({ terrain: colony.terrain, structures: colony.structures });
  return planSupply(colony, costMatrix);
}, "planning:planLogistics");

