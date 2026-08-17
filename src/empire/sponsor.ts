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

export interface SponsorPick {
  colony?: Colony;
  reason?: "no colonies" | "unreachable" | "unaffordable";
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
