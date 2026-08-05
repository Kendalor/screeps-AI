// The room-graph walk scouting depends on — the one place Game.map.describeExits is touched.
// Shared by the snapshot builder and the scout behaviour so both see the same frontier.

import { roomType } from "../lib/roomName";
import { NO_PATH_RETRY_AFTER } from "../lib/remotePath";
import type { ScoutCandidate } from "./types";

/** Every room reachable from `origin` within `radius` steps (BFS over describeExits), including
 * origin itself at distance 0 (it already has permanent vision, so it's scouting-eligible for
 * passive recording — see Scouting — but callers must never dispatch a scout to its own home room),
 * and excluding any room behind a closed/novice boundary, which a scout cannot enter.
 *
 * A neighbour is eligible only if its status matches the status of the room being exited FROM (not
 * `origin`'s status — see below). The World places real, invisible-to-terrain STRUCTURE_WALL objects
 * along the border between a respawn/novice protection zone and whatever lies outside it, on the zone
 * side, regardless of the outside room's own status; Game.map.describeExits/getTerrain report the exit
 * as open because the wall is a structure, not terrain, so this status compare is the only signal that
 * catches it. Confirmed on shard0: E27S3 (status "respawn") had zero wall structures on the three
 * borders shared with other "respawn" rooms in the same zone, but a full wall along the border with
 * E26S3 (status "normal") — a neighbour whose own status is "normal" is NOT automatically enterable.
 *
 * This must compare against the *current* room's status at each BFS step, not a single `homeStatus`
 * captured once at `origin`: once the walk has legitimately crossed out into a "normal" room (both
 * sides "normal", no wall), every further hop compares against "normal" too, not origin's original
 * zone status — a bare `origin`-status comparison would incorrectly wall off everything past the first
 * legitimate crossing.
 *
 * `home` (optional) additionally stops the walk from expanding PAST a room a scout has already proven,
 * empirically, it cannot walk into from this home — see schema.ts's ScoutInfo.noPathFrom doc. Unlike the
 * zone-status wall above, a player-built border wall is invisible to describeExits/getTerrain entirely;
 * the only place that ever learns about it is moveToRoom's travelTo failure, recorded on the
 * DESTINATION room's own ScoutInfo. That room still gets included in the output at its own distance (a
 * scout can always reach its exit tile and observe it — see noPathFrom's doc), only its neighbours are
 * skipped, so the frontier stops silently inflating scoutTargets/todo with rooms behind a sealed border.
 * Omitted entirely by callers that don't root the walk at an actual scouting colony (pickColonyTargets.ts,
 * remoteInvaderAttacks.ts use this for pure topology scoring/staleness, not frontier dispatch), since
 * noPathFrom is keyed by the home a scout actually failed to enter from — meaningless without one. The
 * retry window (NO_PATH_RETRY_AFTER) matches remotePath.ts's identical negative-cache pattern: a border
 * wall is usually permanent, but this stays a retry rather than a forever-cache in case the observation
 * was a transient fluke (e.g. a creep briefly blocking the only open tile). */
export function scoutCandidatesAround(origin: string, radius: number, home?: string): ScoutCandidate[] {
  const seen = new Set<string>([origin]);
  let frontier: string[] = [origin];
  const originStatus = Game.map.getRoomStatus(origin).status;
  const statusOf = new Map<string, string>([[origin, originStatus]]);

  const out: ScoutCandidate[] = [
    { room: origin, distance: 0, type: roomType(origin), info: Memory.rooms?.[origin]?.scouted }
  ];
  for (let depth = 0; depth < radius && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const name of frontier) {
      // A sealed border is only known once the room itself has already been reached (see doc above), so
      // it's checked here — before expanding ITS exits — rather than when the room was first added.
      if (home !== undefined && isSealedFrom(name, home)) continue;
      // A room proven lethal (schema.ts's ScoutInfo.lethalAt doc) already excludes itself as a scout
      // DESTINATION via needsScouting, but without this the BFS still walks past it to keep offering
      // everything behind it as "frontier" candidates — rooms no scout can actually reach without first
      // dying in the one that's in the way. Unlike noPathFrom's sealed-border case (a scout can still
      // stand at the sealed room's own exit tile, just not go further), a lethal room can't even be
      // entered safely, so nothing past it is reachable either — same backoff window as isSealedFrom,
      // since a tower can be destroyed or the room can change hands later.
      if (home !== undefined && isLethal(name)) continue;
      const exits = Game.map.describeExits(name);
      if (!exits) continue;
      const fromStatus = statusOf.get(name)!;
      for (const dir in exits) {
        const neighbour = exits[dir as ExitKey]!;
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        const status = Game.map.getRoomStatus(neighbour).status;
        if (status !== fromStatus) continue;
        statusOf.set(neighbour, status);
        next.push(neighbour);
        out.push({
          room: neighbour,
          distance: depth + 1,
          type: roomType(neighbour),
          info: Memory.rooms?.[neighbour]?.scouted // Memory.rooms is lazily created; guard, don't index blind
        });
      }
    }
    frontier = next;
  }
  return out;
}

// Whether a scout has already proven, within the retry window, that it cannot enter `room` from `home`.
function isSealedFrom(room: string, home: string): boolean {
  const noPathAt = Memory.rooms?.[room]?.scouted?.noPathFrom?.[home];
  return noPathAt !== undefined && Game.time - noPathAt < NO_PATH_RETRY_AFTER;
}

// Whether `room` killed one of our creeps recently enough that walking through it is still off-limits
// (mirrors execute.ts's dangerRouteCost, which prices such a room Infinity as a transit hop).
function isLethal(room: string): boolean {
  const lethalAt = Memory.rooms?.[room]?.scouted?.lethalAt;
  return lethalAt !== undefined && Game.time - lethalAt < NO_PATH_RETRY_AFTER;
}

/** Whether consecutive rooms in a Game.map.findRoute-style hop list cross a respawn/novice zone boundary
 * — the same status-match rule scoutCandidatesAround's BFS applies (see its doc for why: the World places
 * a real, invisible-to-findRoute STRUCTURE_WALL there). `rooms` includes `origin` at index 0 so every
 * consecutive pair is checked, matching the BFS's from-room (not origin) comparison. findRoute itself is
 * blind to these walls and will happily price a route straight through one, so this is the only guard —
 * callers must reject (not just deprioritize) any route this flags, the way they already reject ERR_NO_PATH. */
export function crossesSealedBorder(rooms: readonly string[]): boolean {
  for (let i = 1; i < rooms.length; i++) {
    if (Game.map.getRoomStatus(rooms[i - 1]).status !== Game.map.getRoomStatus(rooms[i]).status) return true;
  }
  return false;
}
