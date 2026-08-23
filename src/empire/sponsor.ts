// Shared core for every "which colony sponsors this flag-triggered target" picker
// (attack/defend/parade/drain/colonize/the SingleTargetFlagOperation family). All apply the same rule —
// nearest reachable colony (real room-graph hops, via the injected roomDistance) that can afford the
// operation's body, ties broken by name for determinism — and previously reimplemented it repeatedly with
// only the affordability floor and reason union differing. That set of near-identical files was the actual
// duplication; the operations themselves stay genuinely separate, each with its own floor.
//
// Two ways in: pickSponsor (the raw floor-as-a-number core, used directly by attack/defend/parade/drain,
// each of which keeps its own thin *Sponsor.ts wrapper — see e.g. drainSponsor.ts — because their floor
// needs its own doc comment explaining where the number comes from), and pickSponsorFor (below), which
// reads the floor straight off an operation CLASS's static sponsorConfig instead of a sibling file —
// every SingleTargetFlagOperation subclass uses this one, so a sixth single-target operation needs no new
// sponsor file at all, just one static field next to the body/priority it's derived from.

import type { Colony } from "../colony";
import type { SponsorConfig } from "../operations/operation";
import type { RoomDistance } from "./spawning";
import { pickAvailableTier } from "./boostAvailability";
import type { TierRequest } from "./boostTier";
import { availableEmpireStock, type ColonyEmpireStock } from "./logistics";

export interface SponsorPick {
  colony?: Colony;
  reason?: "no colonies" | "unreachable" | "unaffordable" | "boostTierUnavailable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford `floor` energy
 * capacity right now. Ties break by name for determinism. */
export function pickSponsor(colonies: readonly Colony[], target: string, floor: number, roomDistance: RoomDistance): SponsorPick {
  if (colonies.length === 0) return { reason: "no colonies" };

  const affordable = colonies.filter(c => c.snapshot.energyCapacity >= floor);
  if (affordable.length === 0) return { reason: "unaffordable" };

  let best: Colony | undefined;
  let bestDist = Infinity;
  for (const c of affordable) {
    const d = roomDistance(c.name, target);
    if (d < bestDist || (d === bestDist && best !== undefined && c.name.localeCompare(best.name) < 0)) {
      best = c;
      bestDist = d;
    }
  }
  if (!best || !Number.isFinite(bestDist)) return { reason: "unreachable" };
  return { colony: best };
}

/** Nearest colony that can afford `OpClass`'s own minCost (operations/operation.ts's SponsorConfig) — the
 * one-line wrapper every SingleTargetFlagOperation subclass's flags module calls instead of hand-rolling
 * pickSponsor's loop (see this file's header). Takes the class itself (not an instance) since
 * sponsorConfig is static — there is no operation instance to sponsor yet, that's the whole point of
 * picking one. */
export function pickSponsorFor(
  OpClass: { readonly sponsorConfig: SponsorConfig },
  colonies: readonly Colony[],
  target: string,
  roomDistance: RoomDistance
): SponsorPick {
  return pickSponsor(colonies, target, OpClass.sponsorConfig.minCost, roomDistance);
}

/** A boost-tier request to additionally check once an ordinary sponsor pick already succeeded (gh #68) —
 * see pickBoostedSponsor's own doc for how this plugs in. `tierRequest` is #65's parseTierSegment output;
 * `resolveCompound`/`colonies`/`reservedOf` are the exact injected dependencies #67's pickAvailableTier and
 * #64's availableEmpireStock already take (see boostAvailability.ts / logistics.ts) — this function is a
 * thin composition of both, not a new stock/compound authority of its own. */
export interface BoostRequest {
  requiredActions: readonly string[];
  tierRequest: TierRequest;
  neededAmount: number;
  resolveCompound: (action: string, tier: 1 | 2 | 3) => ResourceConstant | undefined;
  colonies: readonly ColonyEmpireStock[];
  reservedOf: (colony: string) => number;
}

/** pickSponsor, plus an advisory boost-tier-availability check (gh #68, epic #61) run only once the
 * ordinary pick already succeeded — the existing "no colonies" -> "unaffordable" -> "unreachable" order is
 * completely unchanged (this function calls pickSponsor first and returns its result verbatim on failure).
 * A forced-tier request checks empire-wide stock for exactly that tier and rejects with
 * "boostTierUnavailable" if short, with NO fallback to a lower tier even if one would have cleared — the
 * caller asked for a specific tier on purpose. A greedy request runs #67's T3->T2->T1 walk and only rejects
 * if none of the three tiers clears the bar for every required action. Either way this is purely advisory:
 * it only READS availableEmpireStock, it never reserves/claims anything — a later real send still has to
 * re-check and actually commit the reservation itself.
 *
 * A malformed ("invalid") tierRequest reaching this function is a caller bug (the flag/console parser
 * should already have rejected it before ever calling sponsor-pick) — rather than throwing on unexpected
 * input, it's treated as an unconditional "boostTierUnavailable", the safest default available from this
 * function's existing reason union. */
export function pickBoostedSponsor(
  colonies: readonly Colony[],
  target: string,
  floor: number,
  roomDistance: RoomDistance,
  boost: BoostRequest
): SponsorPick {
  const base = pickSponsor(colonies, target, floor, roomDistance);
  if (!base.colony) return base;

  const availableStock = (resource: ResourceConstant): number => availableEmpireStock(boost.colonies, resource, boost.reservedOf);

  if (boost.tierRequest.kind === "invalid") return { reason: "boostTierUnavailable" };

  if (boost.tierRequest.kind === "forced") {
    const tier = boost.tierRequest.tier;
    const allClear = boost.requiredActions.every(action => {
      const compound = boost.resolveCompound(action, tier);
      if (compound === undefined) return false;
      return availableStock(compound) >= boost.neededAmount;
    });
    return allClear ? base : { reason: "boostTierUnavailable" };
  }

  // greedy
  const availability = pickAvailableTier(boost.requiredActions, boost.resolveCompound, availableStock, boost.neededAmount);
  return availability.kind === "available" ? base : { reason: "boostTierUnavailable" };
}
