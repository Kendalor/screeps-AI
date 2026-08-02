// Picks which existing colony should sponsor an attack request at `target` — same "closest, reachable,
// affordable" filter pickColonizeSponsor uses for colonize (see colonizeSponsor.ts's header for why
// roomDistance must be a real Game.map.findRoute-based distance, not the spawn arbiter's Chebyshev
// estimate). A separate function rather than reusing pickColonizeSponsor directly: the affordability
// floor is a single attacker set (ATTACKER_MIN_COST), not a fixed 600-energy CLAIM body, and there is no
// GCL room-budget gate — attacking a room claims nothing.

import type { Colony } from "../colony";
import { ATTACKER_MIN_COST } from "../behaviors/roles/attacker";
import type { RoomDistance } from "./spawning";

export interface AttackSponsorResult {
  colony?: Colony;
  reason?: "no colonies" | "unreachable" | "unaffordable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford an attacker body
 * right now. Ties break by name for determinism. */
export function pickAttackSponsor(colonies: readonly Colony[], target: string, roomDistance: RoomDistance): AttackSponsorResult {
  if (colonies.length === 0) return { reason: "no colonies" };

  const affordable = colonies.filter(c => c.snapshot.energyCapacity >= ATTACKER_MIN_COST);
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
