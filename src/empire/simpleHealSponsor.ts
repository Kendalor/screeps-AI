// Picks which existing colony should sponsor a SimpleHeal request at `target` — same "closest, reachable,
// affordable" filter drainSponsor/paradeSponsor/simpleBaitTowerSponsor/demolishSponsor use (see
// drainSponsor.ts's header for why roomDistance must be a real Game.map.findRoute-based distance, not
// the spawn arbiter's Chebyshev estimate).

import type { Colony } from "../colony";
import { SIMPLE_HEALER_MIN_COST } from "../behaviors/roles/simpleHealer";
import type { RoomDistance } from "./spawning";

export interface SimpleHealSponsorResult {
  colony?: Colony;
  reason?: "no colonies" | "unreachable" | "unaffordable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford a single
 * SimpleHealer creep right now. Ties break by name for determinism. */
export function pickSimpleHealSponsor(
  colonies: readonly Colony[],
  target: string,
  roomDistance: RoomDistance
): SimpleHealSponsorResult {
  if (colonies.length === 0) return { reason: "no colonies" };

  const affordable = colonies.filter(c => c.snapshot.energyCapacity >= SIMPLE_HEALER_MIN_COST);
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
