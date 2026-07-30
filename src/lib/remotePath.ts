// Real cross-room haul-path between a home anchor and a remote source, via PathFinder — the ground truth
// mining/distance.ts's room-hop/tile-inset estimate only approximates. Screeps terrain is public data
// (backs PathFinder's native search even without vision), so this resolves correctly for a scouted-but-
// unvisited remote room. `incomplete` doubles as the real connectivity check the room-hop count alone
// can't do: a room can be graph-reachable within the scouting BFS yet still have no walkable route (e.g.
// the shared border is all wall), and PathFinder is the only thing that actually knows that.
//
// Callers should compute this once per (home, source) pair and cache the result (see setRemotes in
// intents/execute.ts) — the source position and the anchor position never move, so neither does the path.

import type { RemoteRouteTile, ScoutedSource } from "../memory/schema";
import type { XY } from "./geometry";

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

// A room-tagged tile list, the shape construction claims need — deliberately not a decoder for
// serializeRemotePath's digit string. Replaying direction digits back across a room boundary needs the
// same cross-room coordinate math that corrupted scout pathing before (see scout-ping-pong); reusing
// the already-computed RoomPosition[] here sidesteps that class of bug entirely, at the cost of caching
// the same path twice in two shapes.
//
// Exit tiles (x or y at the room's edge) can never have a construction site: Screeps refuses any
// structure there, road included, even though a creep walks through one fine. Exported so mining.ts
// can apply the same check when turning a *cached* route into road claims — a route computed before
// this exclusion existed may still have an exit tile baked in until it's next recomputed, and skipping
// it at claim time fixes that retroactively without needing to touch the cache.
export function isExitTile(p: XY): boolean {
  return p.x === 0 || p.x === 49 || p.y === 0 || p.y === 49;
}

export function toRouteTiles(path: readonly RoomPosition[]): RemoteRouteTile[] {
  return path.filter(p => !isExitTile(p)).map(p => ({ room: p.roomName, x: p.x, y: p.y }));
}

// The one place that resolves a scouted source's real home->source distance: reuses `scouted`'s cache
// if both `paths[home]` and `route[home]` are already there, otherwise runs PathFinder once and writes
// both back onto it (mutating in place, same non-destructive-add rule as the rest of the memory cache).
// Shared by resolveRemoteRoom (post-selection, execute.ts) and the scouting pass that now precomputes
// this before selection ever runs — one cache, one PathFinder call per (home, source), regardless of
// which caller gets there first. `sourceRoom` is the room the source itself lives in — ScoutedSource
// doesn't carry its own room name (it's nested under that room's own ScoutInfo), so the caller, which
// already knows which room it's iterating, supplies it.
export function resolvePathToSource(
  home: string,
  anchor: XY,
  sourceRoom: string,
  scouted: ScoutedSource
): { distance: number; route: RemoteRouteTile[] } | undefined {
  const cachedPath = scouted.paths?.[home];
  const cachedRoute = scouted.route?.[home];
  if (cachedPath !== undefined && cachedRoute !== undefined) {
    return { distance: cachedPath.length, route: cachedRoute };
  }
  const path = findRemotePath(
    new RoomPosition(anchor.x, anchor.y, home),
    new RoomPosition(scouted.x, scouted.y, sourceRoom)
  );
  if (!path) return undefined;
  const serialized = serializeRemotePath(new RoomPosition(anchor.x, anchor.y, home), path);
  const route = toRouteTiles(path);
  (scouted.paths ??= {})[home] = serialized;
  (scouted.route ??= {})[home] = route;
  return { distance: serialized.length, route };
}
