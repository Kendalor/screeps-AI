// The scout behaviour's pure core. A scout walks between rooms recording what it sees; the one
// decision that can be made without touching Game — *which* room to walk to next — lives here so it
// is unit-testable. The travel and the observation-recording that wrap it are glue in
// empire/creeps.ts, where Game and the live Room are unavoidable.

import { roomLinearDistance } from "../lib/roomName";
import { needsScouting } from "../operations/scouting";
import type { ScoutCandidate } from "../snapshot/types";

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
