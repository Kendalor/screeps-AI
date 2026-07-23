// The scout behaviour's pure core: the two decisions that need no Game — whether a room's data has
// gone stale, and which room a scout should walk to next. Both the Scouting operation (which sizes
// the fleet and drives it via intents) and any test read these directly. The travel, the live-room
// observation, and the route computation are execute.ts/interpreter glue, where Game is unavoidable.

import { roomLinearDistance, type RoomType } from "../lib/roomName";
import type { ScoutCandidate } from "../snapshot/types";

// Re-survey intervals per room type, in ticks. A normal room's controller/sources barely change, so
// its data is good for a long time; a highway carries only transient rare resources (power banks,
// deposits) and must be re-checked often to catch them before they decay. Ported from legacy
// RoomMemoryUtil's SCOUTING_INTERVALL constants.
const STALE_AFTER: Record<RoomType, number> = {
  normal: 100000,
  keeper: 200000,
  highway: 3000,
  intersection: 3000
};

/** The re-survey interval for a room type, exposed so the behaviour, the operation and tests agree
 * on what "stale" means. */
export function staleAfter(type: RoomType): number {
  return STALE_AFTER[type];
}

/**
 * Whether a candidate room is worth a scout's visit right now: true if it was never observed, or its
 * last observation is older than its type's re-survey interval. `now` is passed explicitly (the
 * snapshot's tick) so the decision is pure and unit-testable without Game.time.
 */
export function needsScouting(candidate: ScoutCandidate, now = 0): boolean {
  const info = candidate.info;
  if (!info || info.tick === undefined) return true; // never physically seen
  return now - info.tick >= staleAfter(candidate.type);
}

/**
 * The next room a scout standing in `from` should survey: the nearest candidate that still needs
 * scouting, ties broken by room name so the choice is deterministic — two scouts handed the same
 * todo never oscillate, and a single scout re-picks the same target every tick until it arrives.
 *
 * Distance is measured from the scout's *current* room, not its home colony, so a scout already out
 * on the frontier keeps pushing outward instead of walking back toward the nearest-to-home room.
 * Returns undefined when nothing in the todo needs scouting — the caller lets the scout idle (or die
 * off) until an observation goes stale.
 */
export function pickScoutTarget(
  todo: readonly ScoutCandidate[],
  from: string,
  now: number
): string | undefined {
  const open = todo.filter(t => needsScouting(t, now));
  if (open.length === 0) return undefined;

  return open
    .slice()
    .sort((a, b) => roomLinearDistance(from, a.room) - roomLinearDistance(from, b.room) || a.room.localeCompare(b.room))[0]
    .room;
}
