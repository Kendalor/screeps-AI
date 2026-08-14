// Picks which existing colony should sponsor a drain request at `target` — ADR 0006 explicitly keeps
// Drain parallel to Attack, not merged into it, and the affordability floor differs from every other
// sponsor: a full 4-creep squad (1 attacker + 3 healers), not a single body. Thin wrapper over
// sponsor.ts's shared "nearest reachable affordable colony" core; see that file's header for why the
// five sponsor pickers share one core instead of each reimplementing it.

import type { Colony } from "../colony";
import { DRAIN_ATTACKER_MIN_COST } from "../behaviors/roles/drainAttacker";
import { DRAIN_HEALER_MIN_COST } from "../behaviors/roles/drainHealer";
import { pickSponsor } from "./sponsor";
import type { RoomDistance } from "./spawning";

// ADR 0006's fixed composition: 1 melee attacker + 3 healers. The spawn arbiter (empire/spawning.ts)
// fills CreepRequests one at a time against a colony's *current* energyAvailable, not a lump sum against
// energyCapacity — so the affordability floor here is the single most expensive body in the squad (a
// colony that can eventually afford one healer can afford all three, one spawn cycle at a time), not the
// summed cost of every squad member at once. A colony below this floor can never spawn even the first
// squad member, whichever role it is.
const DRAIN_SQUAD_MIN_COST = Math.max(DRAIN_ATTACKER_MIN_COST, DRAIN_HEALER_MIN_COST);

export interface DrainSponsorResult {
  colony?: Colony;
  reason?: "no colonies" | "unreachable" | "unaffordable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford a full drain
 * squad (1 attacker + 3 healers, ADR 0006) right now. Ties break by name for determinism. */
export function pickDrainSponsor(colonies: readonly Colony[], target: string, roomDistance: RoomDistance): DrainSponsorResult {
  return pickSponsor(colonies, target, DRAIN_SQUAD_MIN_COST, roomDistance);
}
