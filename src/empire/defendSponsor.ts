// Picks which existing colony should sponsor a defend request at `target` — the defensive twin of
// pickAttackSponsor (attackSponsor.ts): affordability floor is a single defender set
// (DEFENDER_MIN_COST), not an attacker set, and there is no GCL room-budget gate — defending a room
// claims nothing. Thin wrapper over sponsor.ts's shared "nearest reachable affordable colony" core; see
// that file's header for why the five sponsor pickers share one core instead of each reimplementing it.

import type { Colony } from "../colony";
import { DEFENDER_MIN_COST } from "../behaviors/roles/defender";
import { pickSponsor } from "./sponsor";
import type { RoomDistance } from "./spawning";

export interface DefendSponsorResult {
  colony?: Colony;
  // Widened to match sponsor.ts's SponsorPick (gh #68 added "boostTierUnavailable" for pickBoostedSponsor)
  // since this wrapper returns pickSponsor's result verbatim; pickSponsor itself never produces that
  // reason, only pickBoostedSponsor does, so it's unreachable here in practice, just required for the type
  // to still describe what pickSponsor's real return type now allows.
  reason?: "no colonies" | "unreachable" | "unaffordable" | "boostTierUnavailable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford a defender body
 * right now. Ties break by name for determinism. */
export function pickDefendSponsor(colonies: readonly Colony[], target: string, roomDistance: RoomDistance): DefendSponsorResult {
  return pickSponsor(colonies, target, DEFENDER_MIN_COST, roomDistance);
}
