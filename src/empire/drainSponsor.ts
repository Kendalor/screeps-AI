// Picks which existing colony should sponsor a drain request at `target` — same "closest, reachable,
// affordable" filter pickAttackSponsor uses for attack (see attackSponsor.ts's header for why
// roomDistance must be a real Game.map.findRoute-based distance, not the spawn arbiter's Chebyshev
// estimate). A separate parallel function rather than a shared generic: ADR 0006 explicitly keeps Drain
// parallel to Attack, not merged into it, and the affordability floor differs — a full 4-creep squad
// (1 attacker + 3 healers) rather than a single attacker body. pickAttackSponsor/pickColonizeSponsor
// already duplicate this same shape for their own floors; this is a third sibling, not a new abstraction.

import type { Colony } from "../colony";
import { DRAIN_ATTACKER_MIN_COST } from "../behaviors/roles/drainAttacker";
import { DRAIN_HEALER_MIN_COST } from "../behaviors/roles/drainHealer";
import type { RoomDistance } from "./spawning";

// ADR 0006's fixed composition: 1 melee attacker + 3 healers. A colony that can't afford the whole
// squad's floor can't sponsor a drain at all — spawning a partial squad (e.g. attacker with no healers)
// would just die to the first tower volley, defeating the operation's entire point.
const DRAIN_SQUAD_MIN_COST = DRAIN_ATTACKER_MIN_COST + 3 * DRAIN_HEALER_MIN_COST;

export interface DrainSponsorResult {
  colony?: Colony;
  reason?: "no colonies" | "unreachable" | "unaffordable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford a full drain
 * squad (1 attacker + 3 healers, ADR 0006) right now. Ties break by name for determinism. */
export function pickDrainSponsor(colonies: readonly Colony[], target: string, roomDistance: RoomDistance): DrainSponsorResult {
  if (colonies.length === 0) return { reason: "no colonies" };

  const affordable = colonies.filter(c => c.snapshot.energyCapacity >= DRAIN_SQUAD_MIN_COST);
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
