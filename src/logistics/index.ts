// planLogistics: the one per-tick entry point Logistics.intents() calls. Wires graph + allocate +
// reserved-folding — thin by design, since the interesting logic already lives in graph.ts/allocate.ts.
// Plans BOTH fleets in one coordinated pass — transport (the general mover) and supply (the
// spawn/tower topper, restricted to graph.ts's supplyProviders/supplyConsumers) — so the two can never
// double-book the same node; there is deliberately no separate supply-only entry point (Supply the
// operation has no logistics planning of its own, see operations/supply.ts).

import { buildCostMatrix, type RoadCostMatrix } from "../layouts/roads";
import { wrapFn } from "../lib/profiler";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import { allocate, emptyReserved, refKey, type ReservedAmounts } from "./allocate";
import { consumers, storageOverflow, supplyConsumers, supplyProviders, transportProviders } from "./graph";
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

// Folds one already-computed plan's assignments into `reserved`, so a second allocate() pass sharing
// the same providers/consumers can't send its own creeps at a node the first pass just claimed. Same
// per-leg accounting as foldReserved, just reading a fresh plan's chains instead of memory.logistics.
function foldPlan(reserved: ReservedAmounts, assignments: Record<Id<Creep>, LogisticsTask>): void {
  for (const creepId in assignments) {
    for (let leg: LogisticsTask | undefined = assignments[creepId as Id<Creep>]; leg; leg = leg.next) {
      if (leg.kind === "pickup" && leg.from) {
        reserved.providers[refKey(leg.from)] = (reserved.providers[refKey(leg.from)] ?? 0) + leg.amount;
      } else if (leg.kind === "deliver" && leg.to) {
        reserved.consumers[refKey(leg.to)] = (reserved.consumers[refKey(leg.to)] ?? 0) + leg.amount;
      }
    }
  }
}

// Sums two independently-folded reservation pools (transport's own + supply's) into a fresh one — used
// to seed transport's allocate() call with supply's claims without mutating either input.
function mergeReserved(a: ReservedAmounts, b: ReservedAmounts): ReservedAmounts {
  const out = emptyReserved();
  for (const key in a.providers) out.providers[key] = (out.providers[key] ?? 0) + (a.providers[key] ?? 0);
  for (const key in b.providers) out.providers[key] = (out.providers[key] ?? 0) + (b.providers[key] ?? 0);
  for (const key in a.consumers) out.consumers[key] = (out.consumers[key] ?? 0) + (a.consumers[key] ?? 0);
  for (const key in b.consumers) out.consumers[key] = (out.consumers[key] ?? 0) + (b.consumers[key] ?? 0);
  return out;
}

/**
 * Supply's plan: a restricted view of the same provider/consumer graph — spawn/extensions and towers
 * only on the sink side, never a remote-room pickup on the source side (see graph.ts's
 * supplyProviders/supplyConsumers). Run BEFORE planLogistics (see below) and its claims folded into
 * transport's reserved amounts, since a starved spawn is more urgent than transport's broader load —
 * supply gets first pick of the shared spawnSystem/tower/storage nodes, transport works around it.
 */
function planSupply(colony: ColonySnapshot, costMatrix: RoadCostMatrix): { plan: LogisticsPlan; reserved: ReservedAmounts } {
  const supplyCreeps = colony.creeps.filter(c => c.role === "supply");
  const reserved = foldReserved(supplyCreeps);
  const idle = supplyCreeps.filter(isIdle);
  const assignments =
    idle.length === 0 ? {} : allocate(supplyProviders(colony), supplyConsumers(colony), idle, reserved, null, costMatrix);
  foldPlan(reserved, assignments);
  return { plan: { assignments }, reserved };
}

export const planLogistics = wrapFn(function planLogistics(colony: ColonySnapshot): LogisticsPlan {
  // Built once per tick and reused across every idle creep's pickup search below — same terrain/
  // structure snapshot data the layouts/roads.ts road-planning callers already build a matrix from, so
  // this is no extra Game access, just the same cost matrix asked for repeatedly in one place instead
  // of once per creep.
  const costMatrix = buildCostMatrix({ terrain: colony.terrain, structures: colony.structures });

  // Supply plans first (see planSupply's doc) so transport never double-books a node supply just
  // claimed. Its reservations seed transport's own — supplyReserved already contains supply's
  // in-flight (foldReserved) plus this tick's fresh (foldPlan) claims.
  const { plan: supplyPlan, reserved: supplyReserved } = planSupply(colony, costMatrix);

  const transportCreeps = colony.creeps.filter(c => c.role === "transport");
  const idle = transportCreeps.filter(isIdle);
  if (idle.length === 0) return supplyPlan;

  // A live supply creep owns spawnSystem/tower outright, but only once storage exists to draw from —
  // see consumers()'s skipSupplyTiers doc. With storage empty, supply alone can't be trusted to cover
  // the deficit (it's a short-hop topper, not sized for the room's full spawn throughput), so transport
  // falls back in at spawnSystem's low priority instead of leaving idle, fully-loaded transport creeps
  // stranded while spawn/extensions starve.
  const hasSupply = colony.creeps.some(c => c.role === "supply") && colony.storageEnergy > 0;
  const reserved = mergeReserved(foldReserved(transportCreeps), supplyReserved);
  const assignments = allocate(
    transportProviders(colony),
    consumers(colony, hasSupply),
    idle,
    reserved,
    storageOverflow(colony),
    costMatrix
  );
  return { assignments: { ...supplyPlan.assignments, ...assignments } };
}, "planning:planLogistics");

