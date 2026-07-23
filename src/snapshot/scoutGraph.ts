// The room-graph walk that scouting depends on — the one place Game.map.describeExits is touched.
// Shared by the snapshot builder (which hands the result to the pure Scouting operation) and the
// scout behaviour (which needs the same todo to pick its next room). Keeping it in one function means
// the operation that *sizes* the fleet and the behaviour that *steers* each scout always see the same
// frontier.

import { roomLinearDistance, roomType } from "../lib/roomName";
import type { ScoutCandidate } from "./types";

/**
 * Every room reachable from `origin` within `radius` steps, each carrying its map-grid distance, its
 * type, and whatever scouting last recorded (`info`, absent if never seen). A BFS over describeExits,
 * bounded by radius — the outward-growing frontier legacy's OperationScoutingManager walked, but
 * recomputed each call rather than persisted.
 *
 * The origin itself is excluded (a colony always sees its own room), and rooms behind a closed or
 * novice boundary (getRoomStatus !== "normal", or describeExits === null) are neither returned nor
 * expanded through — a scout cannot enter them.
 */
export function scoutCandidatesAround(origin: string, radius: number): ScoutCandidate[] {
  const seen = new Set<string>([origin]);
  let frontier: string[] = [origin];

  const out: ScoutCandidate[] = [];
  for (let depth = 0; depth < radius && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const name of frontier) {
      const exits = Game.map.describeExits(name);
      if (!exits) continue;
      for (const dir in exits) {
        const neighbour = exits[dir as ExitKey]!;
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        if (Game.map.getRoomStatus(neighbour).status !== "normal") continue;
        next.push(neighbour);
        out.push({
          room: neighbour,
          distance: roomLinearDistance(origin, neighbour),
          type: roomType(neighbour),
          info: Memory.rooms[neighbour]?.scouted
        });
      }
    }
    frontier = next;
  }
  return out;
}
