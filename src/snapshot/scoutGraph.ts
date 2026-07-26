// The room-graph walk scouting depends on — the one place Game.map.describeExits is touched.
// Shared by the snapshot builder and the scout behaviour so both see the same frontier.

import { roomLinearDistance, roomType } from "../lib/roomName";
import type { ScoutCandidate } from "./types";

/** Every room reachable from `origin` within `radius` steps (BFS over describeExits), including
 * origin itself at distance 0 (it already has permanent vision, so it's scouting-eligible for
 * passive recording — see Scouting — but callers must never dispatch a scout to its own home room),
 * and excluding any room behind a closed/novice boundary, which a scout cannot enter. */
export function scoutCandidatesAround(origin: string, radius: number): ScoutCandidate[] {
  const seen = new Set<string>([origin]);
  let frontier: string[] = [origin];

  const out: ScoutCandidate[] = [
    { room: origin, distance: 0, type: roomType(origin), info: Memory.rooms?.[origin]?.scouted }
  ];
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
          info: Memory.rooms?.[neighbour]?.scouted // Memory.rooms is lazily created; guard, don't index blind
        });
      }
    }
    frontier = next;
  }
  return out;
}
