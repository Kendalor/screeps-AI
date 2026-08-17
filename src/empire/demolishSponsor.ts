// Picks which existing colony should sponsor a Demolish request at `target` — same "closest, reachable,
// affordable" filter drainSponsor/paradeSponsor/simpleBaitTowerSponsor use (see drainSponsor.ts's header
// for why roomDistance must be a real Game.map.findRoute-based distance, not the spawn arbiter's
// Chebyshev estimate).

import type { Colony } from "../colony";
import { DEMOLISHER_MIN_COST } from "../behaviors/roles/demolisher";
import type { RoomDistance } from "./spawning";

export interface DemolishSponsorResult {
  colony?: Colony;
  reason?: "no colonies" | "unreachable" | "unaffordable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford a single
 * Demolisher creep right now. Ties break by name for determinism. */
export function pickDemolishSponsor(
  colonies: readonly Colony[],
  target: string,
  roomDistance: RoomDistance
): DemolishSponsorResult {
  if (colonies.length === 0) return { reason: "no colonies" };

  const affordable = colonies.filter(c => c.snapshot.energyCapacity >= DEMOLISHER_MIN_COST);
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
