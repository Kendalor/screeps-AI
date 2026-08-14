// Shared core for every "which colony sponsors this flag-triggered target" picker
// (attack/defend/parade/drain/colonize). All five apply the same rule — nearest reachable colony (real
// room-graph hops, via the injected roomDistance) that can afford the operation's body, ties broken by
// name for determinism — and previously reimplemented it five times with only the affordability floor and
// reason union differing. That set of near-identical files was the actual duplication; the operations
// themselves stay genuinely separate (see attackSponsor.ts etc.), each with its own floor constant and
// its own doc explaining why it isn't reused directly.

import type { Colony } from "../colony";
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
