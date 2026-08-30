// Supply's self-registration + selection (gh #50, ADR 0008/PRD "Pool topology"): the cheap, energy-only,
// tier-first-then-nearest fast path for spawn/extension/tower — mirrors Overmind's TransportRequestGroup/
// Queen split, which also skips rate math for local refills. Deliberately NOT LogisticsRequest (request.ts,
// gh #46): that type carries dAmountdt/multiplier fields whose whole purpose is rate scoring
// (multiplier * amount / distance), and Supply's pool is defined by NOT doing rate math — reusing the
// rate-shaped type here would leave two fields permanently unused/misleading on every SupplyRequest and
// invite a future reader to wonder why Supply never sets them. SupplyRequest is a leaner, dedicated type:
// target + wanted amount + a tier number, ranked tier-first-then-nearest by pickSupplyRequest below, never
// by a computed rate. Self-registration reads live Game.* state directly (no ColonySnapshot indirection),
// same as register.ts's registerMinerContainerOutput.
//
// Scope stays exactly what graph.ts's (now-dead) supplyConsumers() used to cover: spawn/extension (one
// aggregate tier) and tower — never the controller container, storage, minerals, or a remote-room
// structure. Those remain Transport's (or Steward's) job. Live as of gh #53: driven each tick by
// behaviors/supplyTaskRunner.ts's runSupplyTask, itself dispatched from empire/creeps.ts for every
// role==="supply" creep — this module's own registration/selection logic is unchanged from gh #50.
//
// A claimed boost lab's own energy want was added on top of that original scope (gh #61 epic follow-up,
// registerBoostLabRequests below) — deliberately NOT Transport's rate-scored pool, where it lived first:
// logistics/greedyMatch.ts's pickBestPair decides which resource an idle creep acts on using ONLY the
// output (source) side's multiplier (score = output.multiplier * amount / distance), never the input
// (want) side's — so boosting a lab's want-side multiplier there could never actually win the
// cross-resource race unless something also offered a matching boosted-multiplier ENERGY output, which
// nothing did. Confirmed live: a fully lab-claimed, fully compound-stocked demolisher still sat unboosted
// for 900+ ticks (once, indefinitely) waiting on energy alone. Supply's tier-first-then-nearest selection
// has no such asymmetry — a claimed lab simply competes like any other spawn/extension/tower want.
//
// pickSupplyRequest's targetedBy discount (below) was added once Supply's own quota moved from 1 to 2
// (operations/supply.ts): with two creeps independently running this same selection, both picked the same
// nearest starved extension every time — confirmed live — since neither had any way to see the other's
// already-assigned target. Reuses targeted.ts's buildTargetedBy/TargetedBy exactly (same live-scan-fresh-
// every-tick shape as Transport's own discount, gh #49) rather than inventing a second mechanism.

import type { TargetedBy } from "./targeted";

/** One spawn/extension/tower/(claimed boost lab)'s outstanding energy need — Supply's own request shape,
 * no rate math. */
export interface SupplyRequest {
  target: StructureSpawn | StructureExtension | StructureTower | StructureLab;
  /** Free capacity right now — how much this target can still receive. */
  wanted: number;
  /** Selection tier: lower number wins ties against a higher one, checked before distance. */
  tier: number;
}

// Tower and spawn/extension share one base tier: a topped-off tower isn't worth detouring a creep past a
// starved spawn for, so ordinary tower top-off competes on distance like everything else. A tower only
// jumps the queue once it's actually running low (see TOWER_LOW_FRACTION below) — an empty tower during
// an attack is worse than a spawn/extension shortfall, but a merely-not-full one isn't. Lower number =
// higher priority, so pickSupplyRequest's tier-first comparison is a plain numeric min.
//
// boostLab shares towerLow's tier, NOT base — confirmed live this was load-bearing, not a nice-to-have:
// at the same "base" tier as spawn/extension, a claimed lab's energy want lost the nearest-wins tiebreak
// almost every time, because a mature colony's spawn/extension pool is chronically hungry (routinely
// 1500-2000+ combined free capacity, many structures scattered around the bunker) against one or two labs
// — the lab won often enough by luck to eventually complete, but took 600+ ticks (41% of a demolisher's
// 1500-tick lifetime) doing nothing after it had already finished spawning. A claimed lab's need is exactly
// as urgent as a critically-low tower: both represent an already-committed creep (or defense) sitting
// uselessly idle until this energy arrives, categorically more urgent than routine hatchery top-off.
export const SUPPLY_TIER = {
  towerLow: 0,
  boostLab: 0,
  base: 1
} as const;

/** A tower at or below this fraction of capacity is promoted to the higher-priority tier. */
export const TOWER_LOW_FRACTION = 0.5;

/**
 * Registers every spawn/extension in `room` with free energy capacity as SupplyRequests, at the
 * spawnSystem tier — the hatchery-side registration this ticket adds (no hatchery.ts module exists yet;
 * spawn/extension ownership lives here, next to Supply's own pool, rather than invented as a new module
 * standing in for a colony concept this codebase doesn't have yet).
 */
export function registerSpawnSystemRequests(room: Room): SupplyRequest[] {
  const out: SupplyRequest[] = [];
  const structures = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION
  }) as (StructureSpawn | StructureExtension)[];
  for (const s of structures) {
    const wanted = s.store.getFreeCapacity(RESOURCE_ENERGY);
    if (wanted <= 0) continue;
    out.push({ target: s, wanted, tier: SUPPLY_TIER.base });
  }
  return out;
}

/**
 * Registers every tower in `room` with free energy capacity as SupplyRequests. A tower at or below
 * TOWER_LOW_FRACTION of capacity is promoted to the higher-priority tier (it needs the energy urgently,
 * e.g. mid-attack); otherwise it competes at the same base tier as spawn/extension, nearest-first.
 */
export function registerTowerRequests(room: Room): SupplyRequest[] {
  const out: SupplyRequest[] = [];
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_TOWER
  }) as StructureTower[];
  for (const t of towers) {
    const wanted = t.store.getFreeCapacity(RESOURCE_ENERGY);
    if (wanted <= 0) continue;
    const capacity = t.store.getCapacity(RESOURCE_ENERGY) ?? 0;
    const low = capacity > 0 && t.store.getUsedCapacity(RESOURCE_ENERGY) <= capacity * TOWER_LOW_FRACTION;
    out.push({ target: t, wanted, tier: low ? SUPPLY_TIER.towerLow : SUPPLY_TIER.base });
  }
  return out;
}

/** Every live spawn/extension/tower energy need in `room` — the room-scoped half of Supply's pool (see
 * registerBoostLabRequests below for the other half, which needs ColonyMemory rather than just `room`). */
export function registerSupplyRequests(room: Room): SupplyRequest[] {
  return [...registerTowerRequests(room), ...registerSpawnSystemRequests(room)];
}

/**
 * A boost lab's own energy want, expressed as an ordinary SupplyRequest — see this file's header for why
 * this lives here rather than Transport's rate-scored pool. Deliberately NOT gated on an active claim
 * (ColonyMemory.boostClaims) — every one of a colony's reserved boost labs (ColonyMemory.boostLabIds)
 * always wants energy toward full, regardless of whether it's claimed for a compound right now. Confirmed
 * live: gating this on the current claim meant a lab's energy only started filling AFTER a claim
 * appeared, adding ~80-100 ticks of avoidable latency to every boost order on top of whatever the
 * compound delivery itself took — energy is cheap and lab capacity is small, so pre-staging it for
 * whichever claim comes next costs nothing. Competes at `SUPPLY_TIER.boostLab` (== towerLow, above
 * ordinary spawn/extension refill) — see SUPPLY_TIER's own doc for why a boost lab can't just share the
 * base tier. `labs` may contain `undefined` entries (a stale id whose object no longer resolves) —
 * skipped, not an error, same tolerance boostLabs()'s own caller (transportTaskRunner.ts) already has.
 */
export function registerBoostLabRequests(labs: readonly (StructureLab | undefined)[]): SupplyRequest[] {
  const out: SupplyRequest[] = [];
  for (const lab of labs) {
    if (!lab) continue;
    const wanted = lab.store.getFreeCapacity(RESOURCE_ENERGY);
    if (!wanted || wanted <= 0) continue;
    out.push({ target: lab, wanted, tier: SUPPLY_TIER.boostLab });
  }
  return out;
}

/**
 * `request.wanted` discounted by every OTHER live Supply creep already routed toward that same target for
 * energy — Overmind's predicted-amount discount (ADR 0008, targeted.ts's own doc), reused here rather than
 * reimplemented: with two Supply creeps live (see operations/supply.ts's quota-of-2 fix), both used to
 * independently run pickSupplyRequest's tier-first-then-nearest selection with no idea the other existed,
 * so they piled onto the SAME nearest starved extension while a second one sat unfilled — confirmed live,
 * the actual bug this discount fixes. `targetedBy`'s incoming-carry accounting already excludes `exclude`
 * (the creep doing the ranking) so a creep re-evaluating its own already-assigned target isn't discounted
 * by its own claim. A discount can only ever reduce `wanted`, never below 0 — a target already fully
 * covered by another creep's incoming load reads as 0, not skipped outright, so callers filtering on
 * `wanted > 0` naturally drop it while a partially-covered one can still legitimately attract a second
 * creep (mirrors discountedAmount's own "soft, not hard" framing exactly).
 */
function discountedWanted(request: SupplyRequest, targetedBy: TargetedBy, exclude?: Creep): number {
  const legs = targetedBy.get(request.target.id as Id<_HasId>);
  if (!legs || legs.length === 0) return request.wanted;

  let influx = 0;
  const counted = new Set<Creep>();
  for (const { creep, task } of legs) {
    if (task.resource !== RESOURCE_ENERGY) continue;
    if (creep === exclude) continue;
    if (counted.has(creep)) continue;
    counted.add(creep);
    influx += creep.store.getCapacity(RESOURCE_ENERGY) ?? 0;
  }
  return Math.max(0, request.wanted - influx);
}

// Real walkable path length between `from` and `target`, same room only (maxRooms: 1 — Supply's whole pool
// is spawn/extension/tower/boost-lab, always in-room, so a cross-room search is never needed here). Used
// only as pickSupplyRequest's range-tie-breaker, so an incomplete/failed search (e.g. a target boxed in by
// other structures this exact tick) falls back to Infinity rather than throwing — a request that can't be
// reached by a real path is still a candidate on plain range, but should never look BETTER than one that
// resolves a real path, and returning Infinity here means the tie simply keeps whichever candidate was
// already best (first-seen wins, same as pickSupplyRequest's other tie fallback).
function pathLength(from: RoomPosition, target: SupplyRequest["target"]): number {
  const result = PathFinder.search(from, { pos: target.pos, range: 1 }, { maxRooms: 1 });
  return result.incomplete ? Infinity : result.path.length;
}

/**
 * Tier-first-then-nearest selection, no rate math: the lowest tier number present wins outright; among
 * ties at that tier, the request with the smaller `rangeTo` (plain Chebyshev range) wins. A range
 * stalemate — two candidates equidistant by that measure — is broken by `pathLengthTo`, the actual
 * walkable path length, so e.g. a target behind a wall doesn't tie with one in the open just because both
 * sit at the same raw range. `rangeTo`/`pathLengthTo` are injected (rather than this module calling
 * creep.pos.getRangeTo/PathFinder.search itself) so the selection logic stays a plain function over data,
 * testable without a live creep or room. `targetedBy` (default: empty — no discount) is every OTHER live
 * Supply creep's persisted task, folded via targeted.ts's buildTargetedBy; a target already fully covered
 * by another Supply creep's incoming carry (discountedWanted <= 0) is skipped so a second idle creep
 * doesn't pile onto the same extension while a different one sits unfilled. `exclude` should be the creep
 * doing the ranking, mirroring pickBestDiscountedRequest's own param. Undefined when nothing has any real
 * remaining want.
 */
export function pickSupplyRequest(
  requests: readonly SupplyRequest[],
  from: RoomPosition,
  rangeTo: (target: SupplyRequest["target"]) => number = target => from.getRangeTo(target),
  targetedBy: TargetedBy = new Map(),
  exclude?: Creep,
  pathLengthTo: (target: SupplyRequest["target"]) => number = target => pathLength(from, target)
): SupplyRequest | undefined {
  let best: SupplyRequest | undefined;
  let bestRange = Infinity;
  for (const request of requests) {
    if (discountedWanted(request, targetedBy, exclude) <= 0) continue;
    if (best) {
      if (request.tier > best.tier) continue; // a worse tier never wins, regardless of distance
      if (request.tier === best.tier) {
        const range = rangeTo(request.target);
        if (range > bestRange) continue;
        if (range === bestRange) {
          // Range stalemate: fall back to real path length. Strict "<" keeps the current best on a tie,
          // same first-seen-wins convention as the rest of this loop.
          if (pathLengthTo(request.target) >= pathLengthTo(best.target)) continue;
          best = request;
          bestRange = range;
          continue;
        }
        best = request;
        bestRange = range;
        continue;
      }
    }
    // First candidate, or a strictly better tier than the current best: takes over outright.
    best = request;
    bestRange = rangeTo(request.target);
  }
  return best;
}
