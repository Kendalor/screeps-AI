// Picks which existing colony should sponsor a parade request near `room` — same "closest, reachable,
// affordable" filter drainSponsor/attackSponsor use (see drainSponsor.ts's header for why roomDistance
// must be a real Game.map.findRoute-based distance, not the spawn arbiter's Chebyshev estimate). A
// separate parallel function rather than a shared generic, same reasoning as drainSponsor/attackSponsor
// being siblings rather than one merged picker: each operation's affordability floor is its own body.

import type { Colony } from "../colony";
import { PARADE_MEMBER_MIN_COST } from "../behaviors/roles/paradeMember";
import type { RoomDistance } from "./spawning";

export interface ParadeSponsorResult {
  colony?: Colony;
  reason?: "no colonies" | "unreachable" | "unaffordable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford at least one
 * parade member right now. Ties break by name for determinism. */
export function pickParadeSponsor(colonies: readonly Colony[], room: string, roomDistance: RoomDistance): ParadeSponsorResult {
  if (colonies.length === 0) return { reason: "no colonies" };

  const affordable = colonies.filter(c => c.snapshot.energyCapacity >= PARADE_MEMBER_MIN_COST);
  if (affordable.length === 0) return { reason: "unaffordable" };

  let best: Colony | undefined;
  let bestDist = Infinity;
  for (const c of affordable) {
    const d = roomDistance(c.name, room);
    if (d < bestDist || (d === bestDist && best !== undefined && c.name.localeCompare(best.name) < 0)) {
      best = c;
      bestDist = d;
    }
  }
  if (!best || !Number.isFinite(bestDist)) return { reason: "unreachable" };
  return { colony: best };
}
