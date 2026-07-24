// The scout behaviour's pure core: whether a room's data has gone stale, and which room to scout next.

import { roomLinearDistance, type RoomType } from "../lib/roomName";
import type { ScoutCandidate } from "../snapshot/types";

// Re-survey intervals per room type, in ticks; highways carry transient resources so need frequent re-checks.
const STALE_AFTER: Record<RoomType, number> = {
  normal: 100000,
  keeper: 200000,
  highway: 3000,
  intersection: 3000
};

/** The re-survey interval for a room type, exposed so behaviour, operation and tests agree on "stale". */
export function staleAfter(type: RoomType): number {
  return STALE_AFTER[type];
}

/** `now` is passed explicitly (the snapshot's tick) so this stays pure and testable without Game.time. */
export function needsScouting(candidate: ScoutCandidate, now = 0): boolean {
  const info = candidate.info;
  if (!info || info.tick === undefined) return true; // never physically seen
  return now - info.tick >= staleAfter(candidate.type);
}

// Nearest candidate still needing scouting, from the scout's *current* room (not home) so it keeps pushing outward; ties broken by name for determinism.
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
