// Picks which existing colony should sponsor a colonize attempt at `target` — the same "closest,
// reachable, affordable" filter a future empire-scoped auto-picker (phase 2 of the colonize plan) will
// eventually run on its own; today it's the seam a flag-triggered request enters through instead. Pure
// and Game-free (roomDistance is injected, not read from Game.map here), so both the manual flag path and
// the eventual auto-picker can share it without either depending on the other's trigger mechanism.
//
// roomDistance reuses planSpawning's RoomDistance shape ((a, b) => number) but must NOT be
// Game.map.getRoomLinearDistance here the way the spawn arbiter uses it: that's a Chebyshev estimate
// between rooms already known to be on the same reachable continent, and never reports "unreachable" —
// wrong for a colonize target, which can be a different sector/behind a closed border. The real caller
// wires in a Game.map.findRoute-based distance (Infinity on ERR_NO_PATH), matching execute.ts's own
// nearestScoutCandidate convention, so "unreachable" here is a genuine no-route result, not a cheap guess.
//
// The affordability/nearest/tie-break core is sponsor.ts's shared pickSponsor — this file only adds the
// GCL room-budget gate no other sponsor picker needs (see that file's header for why the five sponsor
// pickers share one core instead of each reimplementing it).

import type { Colony } from "../colony";
import { COLONIZER_COST } from "../behaviors/roles/colonizer";
import { pickSponsor } from "./sponsor";
import type { RoomDistance } from "./spawning";

export interface ColonizeSponsorResult {
  colony?: Colony;
  // Set only when no colony qualifies — distinguishes "nobody could afford it" from "nobody can reach
  // it" so the flag handler's error message says something useful instead of a bare "not found".
  reason?: "no colonies" | "unreachable" | "unaffordable" | "gclLimitReached";
}

// GCL room budget: gclLevel (Game.gcl.level, injected by the caller — see the roomDistance doc above for
// why this module never reads Game.* itself) is the hard ceiling on simultaneously-owned controllers.
// Counts owned colonies (colonies.length) PLUS any colonizer already in flight anywhere in the empire — a
// claim attempt reserves its room slot the moment it's sent, not just once it lands, or several colonize
// flags placed in the same tick (or before the first claimer arrives) could all pass this gate and try to
// claim past the real limit. Legacy's canColonize() intended exactly this (baseOps + colonizeOps <
// gcl.level) but had a bug (missing `()` on getColonizeOps) that made its CPU half of the check always
// pass regardless — this rebuilds the room-budget half cleanly rather than porting that bug forward.
// Exported for pickColonyTargets.ts (the empire-scoped auto-picker), which needs the same gate BEFORE
// spending any effort ranking candidates — checking sponsor-affordability/reachability for a target the
// empire can't legally claim at all would be wasted work.
export function gclRoomBudgetOk(colonies: readonly Colony[], gclLevel: number): boolean {
  const inFlight = colonies.reduce((n, c) => n + c.snapshot.creeps.filter(cr => cr.role === "colonizer").length, 0);
  return colonies.length + inFlight < gclLevel;
}

/** Nearest colony (real room-graph hops, via the injected roomDistance) that can afford a colonizer
 * body right now. Ties break by name for determinism. A colony already sponsoring this exact target
 * (a live colonizer with this targetRoom) is not re-picked — the flag handler checks that separately,
 * same ownership shape Colonize.desiredCreeps() itself uses. */
export function pickColonizeSponsor(
  colonies: readonly Colony[],
  target: string,
  roomDistance: RoomDistance,
  gclLevel: number
): ColonizeSponsorResult {
  if (colonies.length === 0) return { reason: "no colonies" };
  if (!gclRoomBudgetOk(colonies, gclLevel)) return { reason: "gclLimitReached" };

  return pickSponsor(colonies, target, COLONIZER_COST, roomDistance);
}
