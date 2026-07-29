// Real cross-room haul-path between a home anchor and a remote source, via PathFinder — the ground truth
// mining/distance.ts's room-hop/tile-inset estimate only approximates. Screeps terrain is public data
// (backs PathFinder's native search even without vision), so this resolves correctly for a scouted-but-
// unvisited remote room. `incomplete` doubles as the real connectivity check the room-hop count alone
// can't do: a room can be graph-reachable within the scouting BFS yet still have no walkable route (e.g.
// the shared border is all wall), and PathFinder is the only thing that actually knows that.
//
// Callers should compute this once per (home, source) pair and cache the result (see setRemotes in
// intents/execute.ts) — the source position and the anchor position never move, so neither does the path.

export function findRemotePath(anchor: RoomPosition, source: RoomPosition): RoomPosition[] | undefined {
  const result = PathFinder.search(anchor, { pos: source, range: 1 }, {
    plainCost: 2,
    swampCost: 10,
    maxRooms: 16
  });
  return result.incomplete ? undefined : result.path;
}

// One direction digit per tile (Traveler's own serializePath format — see lib/traveler.ts), so the
// string's length is the path's tile length and the string itself is already what a creep would need to
// walk it later (e.g. for road placement) via Room.deserializePath/moveByPath.
export function serializeRemotePath(start: RoomPosition, path: readonly RoomPosition[]): string {
  let out = "";
  let last = start;
  for (const pos of path) {
    out += last.getDirectionTo(pos);
    last = pos;
  }
  return out;
}
