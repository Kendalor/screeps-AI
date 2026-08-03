// The room-graph walk scouting depends on — the one place Game.map.describeExits is touched.
// Shared by the snapshot builder and the scout behaviour so both see the same frontier.

import { roomType } from "../lib/roomName";
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
 * legitimate crossing. */
export function scoutCandidatesAround(origin: string, radius: number): ScoutCandidate[] {
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
