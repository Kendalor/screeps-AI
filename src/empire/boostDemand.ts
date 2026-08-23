// Pools per-creep boost demand into one summed request per compound (gh #72, epic #61). Several creeps
// spawning at once can independently want the SAME compound (e.g. two healers each wanting 400 LO before
// they're "done") — issuing one lab-fill request per creep would either over-fill (waste, since a lab load
// serves whichever creep boosts next regardless of who "asked") or force the caller to dedupe amounts
// itself. This is the one seam that does that summation, kept deliberately dumb: no lab-assignment, no
// scarcity/availability check against actual stock (that's #73/#74) — just "add up what's wanted, per
// compound, across every creep asking."
//
// Input shape mirrors EmpireRequest/ColonyEmpireStock's own style (empire/logistics.ts): a plain array of
// small per-entity records rather than a Map, since the caller (spawn queue) naturally already HAS a list
// of spawning creeps to iterate, not a keyed collection built for lookup. `creepId` is typed `Id<Creep>`
// (not a bare name string) to match the codebase's existing per-creep keying convention — see
// empire/creeps.ts / lib/squad.ts's `Map<Id<Creep>, ...>` precedent — even though this function itself
// never looks a creep up by it; keeping the field typed lets a caller pass a real creep.id with no cast at
// the call site, and a test fabricate one with `"x" as Id<Creep>` like every other per-creep test fixture
// in this codebase already does.
export interface CreepBoostDemand {
  creepId: Id<Creep>;
  needs: Partial<Record<ResourceConstant, number>>; // compound -> amount this one creep still wants
}

/** Sums `needs` across every creep, per compound — two creeps each wanting 400 of the same compound
 * produce one { compound: 800 } entry, not two separate 400s; different compounds stay separate entries,
 * each summed only across the creeps that actually listed it. A single creep's demand passes through
 * unchanged (sum of one term). Order-independent, no dedup/scarcity logic — purely additive. */
export function aggregateBoostDemand(demands: readonly CreepBoostDemand[]): Partial<Record<ResourceConstant, number>> {
  const pooled: Partial<Record<ResourceConstant, number>> = {};
  for (const demand of demands) {
    for (const [resource, amount] of Object.entries(demand.needs) as [ResourceConstant, number | undefined][]) {
      if (amount == null) continue;
      pooled[resource] = (pooled[resource] ?? 0) + amount;
    }
  }
  return pooled;
}
