// Boost lab allocation pass (gh #74, epic #61) — the integration seam combining stage-B spawning-detection
// (#70, spawningBoostedCreeps), compound-demand aggregation (#72, aggregateBoostDemand), and readiness
// scoring + scarcity tie-break (#73, readinessScore/resolveScarcity) into one coherent per-tick plan. Mirrors
// lib/squad.ts's planSquadMove/planSquadActions shape: compute one shared plan once per colony per tick from
// a plain snapshot, hand back a small per-participant result map, and let each creep's own role logic read
// only its own slice next tick. Not persisted to CreepMemory — recomputed fresh every tick, same as the
// empire-logistics matching pass (empire/logistics.ts's matchEmpireRequests) already treats its own matches.
//
// Only 3 labs per colony are ever reserved for boosting (statically, not dynamically claimed/released) — the
// caller injects exactly which lab ids and their current LabState via `boostLabIds`/`labStates`; this
// function never decides WHICH labs are reserved, only how to divide contending creeps' demand across
// whatever's given (0-3 of them).
//
// `resolveNeeds` is an injected dependency rather than a direct call into gh #66's computeBoostNeeds, because
// #66 (src/empire/boostNeeds.ts) had not landed in this worktree at the time this was written — the same
// "injected dependency, adapt later" pattern #67 used for #62. Once boostNeeds.ts exists, a caller can wire
// `resolveNeeds` as `(id, boosts) => computeBoostNeeds(boosts, body, tier)` (needs a body/tier lookup by id)
// with no change to this file's own logic.
//
// Lab-to-compound matching, once scarcity is resolved: a compound that's ALREADY the exact resource stocked
// in one of the given labs (in any amount, even 0-but-typed — see below) is pinned to that lab; matching an
// already-committed lab to its own compound is strictly better than an arbitrary pick, since re-using it
// needs no unload/reload cycle and is exactly what readinessScore/resolveScarcity are already rewarding
// (the creep whose compound is closest to ready wins the tie-break; giving it a DIFFERENT lab than the one
// actually holding that compound would waste the very readiness this pass just scored). Compounds with no
// stocked lab match at all (nothing stocked yet, or every matching lab already claimed by an
// earlier-assigned compound this same tick) fall through to the first still-free lab, in `boostLabIds` order
// — deterministic (same input order every tick, no randomness/Math.random, no live-state read beyond what's
// passed in), which is all purity requires; WHICH free lab a fresh compound lands in has no behavioral
// consequence since an empty lab is interchangeable with any other empty lab.
import { aggregateBoostDemand, type CreepBoostDemand } from "./boostDemand";
import { readinessScore, resolveScarcity, type BoostOrderNeed, type LabState, type ReadinessEntry } from "./boostReadiness";
import { spawningBoostedCreeps } from "./boostSpawnDetection";
import type { ColonySnapshot } from "../snapshot/types";

export interface BoostLabAssignment {
  labId: Id<StructureLab>; // whichever of the (up to 3) reserved boost labs this creep should walk to
  compound: ResourceConstant;
}

export function planBoostLabAllocation(
  colony: ColonySnapshot,
  boostLabIds: readonly Id<StructureLab>[],
  labStates: readonly LabState[],
  resolveNeeds: (creepId: Id<Creep>, boosts: readonly string[]) => Partial<Record<ResourceConstant, number>>
): Map<Id<Creep>, BoostLabAssignment> {
  const result = new Map<Id<Creep>, BoostLabAssignment>();
  const contenders = spawningBoostedCreeps(colony);
  if (contenders.length === 0) return result;

  // Per-creep needs, resolved once and reused for both aggregation and readiness scoring below.
  const perCreepNeeds = new Map<Id<Creep>, Partial<Record<ResourceConstant, number>>>();
  for (const c of contenders) {
    perCreepNeeds.set(c.id, resolveNeeds(c.id, c.memory.boosts ?? []));
  }

  const demands: CreepBoostDemand[] = contenders.map(c => ({ creepId: c.id, needs: perCreepNeeds.get(c.id) ?? {} }));
  const pooled = aggregateBoostDemand(demands);
  const distinctCompounds = Object.keys(pooled) as ResourceConstant[];
  if (distinctCompounds.length === 0) return result;

  // Which compounds actually get lab capacity this tick: all of them if there's room, otherwise the
  // scarcity tie-break picks a subset (see readiness scoring below — scored per COMPOUND, not per creep,
  // since #72 already established that same-compound creeps are one pooled request, never real contenders
  // against each other).
  let grantedCompounds: ResourceConstant[];
  if (distinctCompounds.length <= boostLabIds.length) {
    grantedCompounds = distinctCompounds;
  } else {
    // One ReadinessEntry per distinct compound: score = readiness of whichever contending creep's need for
    // that compound is furthest along (max across creeps asking for it), matching #73's "commit scarce
    // capacity to whichever order finishes soonest" intent at the compound-pool granularity #72 introduced.
    const entries: ReadinessEntry[] = distinctCompounds.map(compound => {
      const score = Math.max(
        ...contenders
          .filter(c => (perCreepNeeds.get(c.id)?.[compound] ?? 0) > 0)
          .map(c => {
            const needs: BoostOrderNeed[] = Object.entries(perCreepNeeds.get(c.id) ?? {})
              .filter((entry): entry is [ResourceConstant, number] => entry[1] != null)
              .map(([resource, amount]) => ({ compound: resource, amount }));
            return readinessScore(needs, labStates);
          })
      );
      return { creepId: compound, score }; // resolveScarcity is generic over its "entry id" — reused here as a compound id
    });
    const winners = resolveScarcity(entries, boostLabIds.length);
    grantedCompounds = winners.map(w => w.creepId as ResourceConstant);
  }

  // Assign each granted compound to a specific lab: prefer a lab already stocked with that exact compound
  // (see file header), else the first still-free lab in boostLabIds order. Two passes, not one — an
  // unstocked compound's "first free lab" fallback must never run before every OTHER granted compound has
  // had a chance to claim its own already-stocked lab, or an early unstocked compound can grab a lab a
  // later compound is sitting on top of, forcing that later compound into a cold lab for no reason
  // (confirmed live: labs=[A,B], A stocked with Y, B empty, grantedCompounds=[X,Y] in that order — a single
  // pass let X's fallback claim A before Y's own stocked-lab lookup ever ran).
  const labByCompound = new Map<ResourceConstant, Id<StructureLab>>();
  const claimedLabs = new Set<Id<StructureLab>>();
  const unstocked: ResourceConstant[] = [];
  for (const compound of grantedCompounds) {
    const stocked = labStates.find(l => l.resource === compound && boostLabIds.includes(l.labId as Id<StructureLab>));
    if (!stocked) {
      unstocked.push(compound);
      continue;
    }
    claimedLabs.add(stocked.labId as Id<StructureLab>);
    labByCompound.set(compound, stocked.labId as Id<StructureLab>);
  }
  for (const compound of unstocked) {
    const labId = boostLabIds.find(id => !claimedLabs.has(id));
    if (!labId) continue; // no free lab left (shouldn't happen: grantedCompounds.length <= boostLabIds.length)
    claimedLabs.add(labId);
    labByCompound.set(compound, labId);
  }

  // Finally, hand each contending creep an assignment for any of ITS needed compounds that made the cut.
  // A creep needing multiple compounds gets whichever granted one is found first (order-stable via
  // Object.keys); a creep whose only needs were all scarcity-losers is simply absent from the map.
  for (const c of contenders) {
    const needs = perCreepNeeds.get(c.id) ?? {};
    const grantedForThisCreep = (Object.keys(needs) as ResourceConstant[]).find(compound => labByCompound.has(compound));
    if (!grantedForThisCreep) continue;
    result.set(c.id, { labId: labByCompound.get(grantedForThisCreep)!, compound: grantedForThisCreep });
  }

  return result;
}
