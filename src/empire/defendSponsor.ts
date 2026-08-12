// Picks which existing colony should sponsor a defend request at `target` — the defensive twin of
// pickAttackSponsor (attackSponsor.ts), same "closest, reachable, affordable" filter and same reason a
// real Game.map.findRoute-based distance is required rather than the spawn arbiter's Chebyshev estimate
// (see colonizeSponsor.ts's header). A separate function rather than reusing pickAttackSponsor directly:
// the affordability floor is a single defender set (DEFENDER_MIN_COST), not an attacker set, and there
// is no GCL room-budget gate — defending a room claims nothing.

import type { Colony } from "../colony";
import { DEFENDER_MIN_COST } from "../behaviors/roles/defender";
import type { RoomDistance } from "./spawning";

export interface DefendSponsorResult {
  colony?: Colony;
  reason?: "no colonies" | "unreachable" | "unaffordable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford a defender body
 * right now. Ties break by name for determinism. */
export function pickDefendSponsor(colonies: readonly Colony[], target: string, roomDistance: RoomDistance): DefendSponsorResult {
  if (colonies.length === 0) return { reason: "no colonies" };

  const affordable = colonies.filter(c => c.snapshot.energyCapacity >= DEFENDER_MIN_COST);
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
