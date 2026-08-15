// Picks which existing colony should sponsor a SimpleBaitTower request at `target` — same "closest,
// reachable, affordable" filter drainSponsor/paradeSponsor use (see drainSponsor.ts's header for why
// roomDistance must be a real Game.map.findRoute-based distance, not the spawn arbiter's Chebyshev
// estimate). A separate parallel function rather than a shared generic, same reasoning as its siblings:
// each operation's affordability floor is its own body.

import type { Colony } from "../colony";
import { SIMPLE_BAIT_TOWER_MIN_COST } from "../behaviors/roles/simpleBaitTower";
import type { RoomDistance } from "./spawning";

export interface SimpleBaitTowerSponsorResult {
  colony?: Colony;
  reason?: "no colonies" | "unreachable" | "unaffordable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford a single
 * SimpleBaitTower creep right now. Ties break by name for determinism. */
export function pickSimpleBaitTowerSponsor(
  colonies: readonly Colony[],
  target: string,
  roomDistance: RoomDistance
): SimpleBaitTowerSponsorResult {
  if (colonies.length === 0) return { reason: "no colonies" };

  const affordable = colonies.filter(c => c.snapshot.energyCapacity >= SIMPLE_BAIT_TOWER_MIN_COST);
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
