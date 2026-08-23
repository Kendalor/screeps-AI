// Picks which existing colony should sponsor a parade request near `room` — affordability floor is at
// least one parade member (PARADE_MEMBER_MIN_COST). Thin wrapper over sponsor.ts's shared "nearest
// reachable affordable colony" core; see that file's header for why the five sponsor pickers share one
// core instead of each reimplementing it.

import type { Colony } from "../colony";
import { PARADE_MEMBER_MIN_COST } from "../behaviors/roles/paradeMember";
import { pickSponsor } from "./sponsor";
import type { RoomDistance } from "./spawning";

export interface ParadeSponsorResult {
  colony?: Colony;
  // Widened to match sponsor.ts's SponsorPick (gh #68 added "boostTierUnavailable" for pickBoostedSponsor)
  // since this wrapper returns pickSponsor's result verbatim; pickSponsor itself never produces that
  // reason, only pickBoostedSponsor does, so it's unreachable here in practice, just required for the type
  // to still describe what pickSponsor's real return type now allows.
  reason?: "no colonies" | "unreachable" | "unaffordable" | "boostTierUnavailable";
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford at least one
 * parade member right now. Ties break by name for determinism. */
export function pickParadeSponsor(colonies: readonly Colony[], room: string, roomDistance: RoomDistance): ParadeSponsorResult {
  return pickSponsor(colonies, room, PARADE_MEMBER_MIN_COST, roomDistance);
}
