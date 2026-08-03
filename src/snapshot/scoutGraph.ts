// The room-graph walk scouting depends on — the one place Game.map.describeExits is touched.
// Shared by the snapshot builder and the scout behaviour so both see the same frontier.

import { roomType } from "../lib/roomName";
import type { ScoutCandidate } from "./types";

/** Every room reachable from `origin` within `radius` steps (BFS over describeExits), including
 * origin itself at distance 0 (it already has permanent vision, so it's scouting-eligible for
 * passive recording — see Scouting — but callers must never dispatch a scout to its own home room),
 * and excluding any room behind a closed/novice boundary, which a scout cannot enter.
 *
 * A neighbour is eligible if its status is "normal" OR matches `origin`'s own status: a colony can
 * itself sit in a respawn/novice protection zone (its owned room's status is whatever the zone is,
 * not "normal"), and every room inside that same zone is exactly as enterable as home already is —
 * rejecting them by a bare "normal" check would wall the colony into its own single room. A status
 * that matches neither (e.g. a novice zone the colony ISN'T part of) still correctly excludes.
 *
 * `distance` is the BFS depth — real room-graph hops, since a room only ever connects to its N/S/E/W
 * neighbours. This must NOT be replaced with Game.map.getRoomLinearDistance's Chebyshev formula: that
 * treats a diagonal room (reachable only via two hops, if at all) as distance 1, the same as a true
 * neighbour, which both under-prices diagonal remotes and ignores whether a route even exists. The BFS
 * we're already doing here is the ground truth for both. */
export function scoutCandidatesAround(origin: string, radius: number): ScoutCandidate[] {
  const seen = new Set<string>([origin]);
  let frontier: string[] = [origin];
  const homeStatus = Game.map.getRoomStatus(origin).status;

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
        const status = Game.map.getRoomStatus(neighbour).status;
        if (status !== "normal" && status !== homeStatus) continue;
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
