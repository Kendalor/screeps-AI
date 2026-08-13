// Walks a transport creep along a remote source's precomputed home<->source route (mining/pickRemotes'
// resolvePathToSource writes RemoteSourceMemory.route once via a real PathFinder.search over actual
// terrain — the exact path road construction is claimed against, see mining.ts's structures()) instead
// of re-deriving a path live every tick via a generic danger-aware PathFinder.search.
//
// Why this exists: dangerAvoidanceOptions' cost matrix can only price a room's roads when either the
// room has live vision right now, or (as of the dangerCostMatrix fix) this colony's own confirmed-built
// remote-route tiles happen to be cached for that room. Both are approximations layered onto a live
// search that's re-run from scratch nearly every tick a remote-hauling creep's destination changes
// (every pickup/topoff/deliver leg). The route array already IS the real path — walking it directly is
// both correct (no live-vision blind spot at all) and cheaper (no PathFinder.search call).
//
// Falls back to nothing (undefined) whenever the creep isn't currently near any tile of the route in its
// OWN room — never attempts cross-room coordinate math (see the codebase-wide "no world coordinates for
// cross-room logic" rule): the engine teleports a creep between exit tiles rather than smoothly moving
// it, so comparing an x/y in one room against a route tile in another is meaningless. A caller losing the
// route this way (off it, or crossed into an unlisted room) simply falls through to its own normal
// travelTo — never a hard failure.

import type { RemoteRouteTile } from "../memory/schema";

// The remote source route (if any) that passes through a given position's room — checked against EVERY
// selected remote source's route, not just ones whose own room matches, since a route legitimately spans
// several transit rooms between home and the source room (see RemoteRouteTile's doc). When more than one
// route touches this room (two remotes sharing a transit corridor, or two sources in the same remote
// room), picks whichever has a tile nearest `pos` — the one the creep is actually walking. Reads straight
// off ColonyMemory.remotes (same source pickRemotes/mining.ts already treat as the durable,
// vision-independent record — see RemoteSourceMemory's own doc), never Game.* directly, so this stays
// callable from a plain creep/position pair with no live vision required.
export function remoteRouteFor(home: string, pos: { x: number; y: number; roomName: string }): readonly RemoteRouteTile[] | undefined {
  const remotes = typeof Memory !== "undefined" ? Memory.colonies?.[home]?.remotes : undefined;
  if (!remotes) return undefined;
  let best: readonly RemoteRouteTile[] | undefined;
  let bestRange = Infinity;
  for (const remote of remotes) {
    for (const source of remote.sources) {
      if (!source.route) continue;
      for (const tile of source.route) {
        if (tile.room !== pos.roomName) continue;
        const r = Math.max(Math.abs(tile.x - pos.x), Math.abs(tile.y - pos.y));
        if (r < bestRange) {
          best = source.route;
          bestRange = r;
        }
      }
    }
  }
  return best;
}

// Within this range of a route tile, a creep is treated as riding that exact tile of the route (walk to
// the NEXT one along it) rather than merely merging toward it — wide enough to tolerate another creep's
// occupancy nudging it one tile aside, narrow enough that a creep still well off the corridor merges in
// gradually instead of visually snapping sideways onto a distant tile.
const ON_ROUTE_RANGE = 1;

// The route index nearest the creep's current position, restricted to tiles in the creep's own room (see
// module doc — no cross-room comparison: a route tile in a DIFFERENT room than the creep is currently in
// is simply never a candidate). undefined only when this room has no route tile at all, i.e. the route
// doesn't pass through here — every other case returns SOME index, however far off it the creep is; see
// nextRouteStep for what "far off" does with that.
function nearestIndexInRoom(pos: { x: number; y: number; roomName: string }, route: readonly RemoteRouteTile[]): number | undefined {
  let best: number | undefined;
  let bestRange = Infinity;
  for (let i = 0; i < route.length; i++) {
    const tile = route[i];
    if (tile.room !== pos.roomName) continue;
    const r = Math.max(Math.abs(tile.x - pos.x), Math.abs(tile.y - pos.y));
    if (r < bestRange) {
      best = i;
      bestRange = r;
    }
  }
  return best;
}

// The next tile to travel toward, walking the route from the creep's nearest index in the given
// direction (`toward: "source"` increases the index toward route[route.length-1], `"home"` decreases it
// toward route[0]). A creep doesn't need to already be standing ON the route — nearestIndexInRoom finds
// the closest tile in this room regardless of range, so a creep that spawned or detoured off to the side
// is simply routed at that nearest tile first (merging onto the corridor), then walks it tile-by-tile
// once within ON_ROUTE_RANGE. undefined only when the route doesn't pass through the creep's current
// room at all — the caller falls back to its own normal travelTo in that case (see transport.ts).
export function nextRouteStep(
  pos: { x: number; y: number; roomName: string },
  route: readonly RemoteRouteTile[] | undefined,
  toward: "source" | "home"
): RemoteRouteTile | undefined {
  if (!route || route.length === 0) return undefined;
  const index = nearestIndexInRoom(pos, route);
  if (index === undefined) return undefined;
  const tile = route[index];
  const onRoute = Math.max(Math.abs(tile.x - pos.x), Math.abs(tile.y - pos.y)) <= ON_ROUTE_RANGE;
  if (!onRoute) return tile; // merge onto the corridor first
  const nextIndex = toward === "source" ? Math.min(route.length - 1, index + 1) : Math.max(0, index - 1);
  return route[nextIndex];
}
