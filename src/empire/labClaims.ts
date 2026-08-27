// LabRunner core allocation algorithm (docs/boosting-lab-runner-design.md sections 2-3, gh #61 epic).
// REPLACES the older per-creep planBoostLabAllocation (deleted): that function computed a
// Map<Id<Creep>, BoostLabAssignment>, one assignment per creep. Deep research into 6 other Screeps bots'
// boosting implementations found every bot with a real allocator (Overmind, Hivemind) instead has creeps
// self-discover their own lab by scanning for one whose stocked compound matches a still-needed resource —
// neither bot ever persists a per-creep->lab assignment. This function's real output is lab CLAIMS (which
// compound a lab should hold, and how much), not per-creep assignments; see the design doc's "Why the
// previous shape was replaced" section for the full reasoning.
//
// Two-phase allocation, run fresh every call (no memory of its own — the caller persists the returned
// claims to ColonyMemory and passes them back in as `existingClaims` next time):
//
// Phase A (reconcile): each existing claim is dropped if its compound's aggregated demand has fallen to 0
// (nothing needs it anymore, and the lab it occupied becomes free for phase B this same call), or carried
// forward with its `amount` refreshed to the CURRENT aggregated figure if demand is still positive.
//
// Phase B (FCFS): whatever boostLabIds aren't occupied by a phase-A survivor get divided among contenders'
// still-unclaimed compound needs, walked in ascending ticksUntilReady order (soonest-arriving creep's full
// need set is served first, as one unit, never split against a later creep's needs) until either every
// contender's needs are covered or free labs run out.
//
// Purity: no Game/Memory reads, no mutation of inputs — every claim/array returned is freshly built.

export interface LabClaim {
  labId: Id<StructureLab>;
  compound: ResourceConstant;
  amount: number;
}

export interface BoostContender {
  creepId: Id<Creep>;
  // Ticks until this creep can physically reach a lab: remaining spawn time while spawning, or
  // ticksToLive once alive. Lower = arrives sooner = higher priority. Computed by the caller (needs live
  // Game data this pure function must not depend on).
  ticksUntilReady: number;
  // This creep's full remaining (not yet satisfied) compound needs, compound -> amount needed.
  needs: Partial<Record<ResourceConstant, number>>;
}

export function planLabClaims(
  existingClaims: readonly LabClaim[],
  boostLabIds: readonly Id<StructureLab>[],
  contenders: readonly BoostContender[],
  aggregatedDemand: Partial<Record<ResourceConstant, number>>
): LabClaim[] {
  // Phase A: reconcile existing claims against live aggregated demand.
  const carriedForward: LabClaim[] = [];
  const claimedCompounds = new Set<ResourceConstant>();
  const occupiedLabs = new Set<Id<StructureLab>>();
  for (const claim of existingClaims) {
    const demand = aggregatedDemand[claim.compound];
    if (!demand) continue; // 0 or undefined -> drop, freeing the lab for phase B
    carriedForward.push({ ...claim, amount: demand });
    claimedCompounds.add(claim.compound);
    occupiedLabs.add(claim.labId);
  }

  // Phase B: FCFS allocation of whatever's left, soonest-ready contender first.
  const sortedContenders = [...contenders].sort((a, b) => a.ticksUntilReady - b.ticksUntilReady);
  const freeLabs = boostLabIds.filter(id => !occupiedLabs.has(id));
  const newClaims: LabClaim[] = [];

  outer: for (const c of sortedContenders) {
    for (const compound of Object.keys(c.needs) as ResourceConstant[]) {
      if (claimedCompounds.has(compound)) continue; // already covered, no lab needed
      if (freeLabs.length === 0) break outer; // nothing more can be allocated this pass
      const labId = freeLabs.shift()!;
      newClaims.push({ labId, compound, amount: aggregatedDemand[compound] ?? 0 });
      claimedCompounds.add(compound);
    }
  }

  return [...carriedForward, ...newClaims];
}
