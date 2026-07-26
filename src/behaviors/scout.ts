// The scout behaviour's pure core: whether a room's data has gone stale, and which room to scout next.

import { roomLinearDistance, type RoomType } from "../lib/roomName";
import type { ScoutInfo } from "../memory/schema";
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

// Passive re-survey interval: any room with ambient vision (no scout dispatched) refreshes its record
// once it's this old, flat across room types — much tighter than active staleAfter since it costs no
// travel, only a skip-if-unstale check plus (usually) a cheap partial re-observe.
const PASSIVE_STALE_AFTER = 1500;

/** Whether a passively-visible room's record is old enough to refresh; mirrors needsScouting's "never seen" rule. */
export function needsPassiveRecording(info: ScoutInfo | undefined, now: number): boolean {
  if (!info || info.tick === undefined) return true;
  return now - info.tick >= PASSIVE_STALE_AFTER;
}

/** `now` is passed explicitly (the snapshot's tick) so this stays pure and testable without Game.time. */
export function needsScouting(candidate: ScoutCandidate, now = 0): boolean {
  const info = candidate.info;
  if (!info || info.tick === undefined) return true; // never physically seen
  return now - info.tick >= staleAfter(candidate.type);
}

// Nearest candidate still needing scouting, from the scout's *current* room (not home) so it keeps pushing outward; ties broken by name for determinism.
// `avoid` is the room the scout just came from: with only two adjacent stale rooms in range, each is
// forever the other's nearest candidate, so without this a scout ping-pongs between them indefinitely.
// Skipped only when it's the sole remaining candidate, so real progress never stalls.
export function pickScoutTarget(
  todo: readonly ScoutCandidate[],
  from: string,
  now: number,
  avoid?: string
): string | undefined {
  const open = todo.filter(t => needsScouting(t, now));
  if (open.length === 0) return undefined;

  const preferred = avoid ? open.filter(t => t.room !== avoid) : open;
  const pool = preferred.length > 0 ? preferred : open;

  return pool
    .slice()
    .sort((a, b) => roomLinearDistance(from, a.room) - roomLinearDistance(from, b.room) || a.room.localeCompare(b.room))[0]
    .room;
}
