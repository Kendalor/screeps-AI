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

// Cost PathFinder gives a plain tile that isn't otherwise marked — mirrors the plainCost option below,
// duplicated as a constant so preferredTileCost can undercut it deliberately rather than by coincidence.
const PLAIN_COST = 2;
// Cheaper than PLAIN_COST so PathFinder is pulled onto a tile another already-resolved source's route
// picked — same "price the preferred tile strictly below plain terrain" trick construction/planner.ts's
// own cost-matrix building uses for a planned local road.
const PREFERRED_TILE_COST = 1;

// How long a "no route found" result is trusted before retrying — bounds the negative cache below
// rather than caching a failure forever, in case terrain/vision conditions genuinely change (e.g. a
// wall that was actually just an unexplored room border PathFinder couldn't see through yet). Far
// shorter than the success cache (which is permanent — a found route never goes stale), since a retry
// here is cheap insurance against a transient false negative, not a routine re-check.
export const NO_PATH_RETRY_AFTER = 20000;

// "room,x,y" — matches how callers (execute.ts) key the RemoteRouteTile sets they pass as `preferred`.
function tileKey(roomName: string, x: number, y: number): string {
  return `${roomName},${x},${y}`;
}

export function remoteRouteTileKey(tile: { room: string; x: number; y: number }): string {
  return tileKey(tile.room, tile.x, tile.y);
}

// `preferred`: tiles (keyed via remoteRouteTileKey) that should cost less than plain terrain — the
// already-chosen route of a sibling source resolved earlier in the same batch, so a second source
// mined out of the same remote room converges onto the first one's corridor instead of pathing an
// independent line beside it. Undefined/empty behaves exactly as before (no roomCallback needed).
export function findRemotePath(
  anchor: RoomPosition,
  source: RoomPosition,
  preferred?: ReadonlySet<string>
): RoomPosition[] | undefined {
  const result = PathFinder.search(anchor, { pos: source, range: 1 }, {
    plainCost: PLAIN_COST,
    swampCost: 10,
    maxRooms: 16,
    ...(preferred && preferred.size > 0
      ? {
          roomCallback: (roomName: string) => {
            const matrix = new PathFinder.CostMatrix();
            for (const key of preferred) {
              if (!key.startsWith(`${roomName},`)) continue;
              const [, x, y] = key.split(",");
              matrix.set(Number(x), Number(y), PREFERRED_TILE_COST);
            }
            return matrix;
          }
        }
      : {})
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
// `now`: the caller's current tick, for the negative-cache backoff below — a parameter, not a direct
// Game.time read, so this module stays pure/testable without a live Game global (its existing
// convention; see findRemotePath just above, which takes RoomPositions rather than reading Game itself).
export function resolvePathToSource(
  home: string,
  anchor: XY,
  sourceRoom: string,
  scouted: ScoutedSource,
  preferred: ReadonlySet<string> | undefined,
  now: number
): { distance: number; route: RemoteRouteTile[] } | undefined {
  const cachedPath = scouted.paths?.[home];
  const cachedRoute = scouted.route?.[home];
  if (cachedPath !== undefined && cachedRoute !== undefined) {
    return { distance: cachedPath.length, route: cachedRoute };
  }
  // A prior search already came back with no route, and the backoff window hasn't elapsed yet — skip
  // re-running PathFinder.search on a result that's overwhelmingly likely to fail again. Without this,
  // a genuinely unreachable source (blocked border, or any other permanent PathFinder.search failure)
  // gets a full search re-run every single tick forever, since a failure has no other way to mark
  // itself "already tried" the way a success does via paths/route (see execute:act:recordSourcePath in
  // a live profile — this was ~20% of all profiled colony CPU on a single mid-size colony).
  const noPathAt = scouted.noPathAt?.[home];
  if (noPathAt !== undefined && now - noPathAt < NO_PATH_RETRY_AFTER) return undefined;

  const path = findRemotePath(
    new RoomPosition(anchor.x, anchor.y, home),
    new RoomPosition(scouted.x, scouted.y, sourceRoom),
    preferred
  );
  if (!path) {
    (scouted.noPathAt ??= {})[home] = now;
    return undefined;
  }
  const serialized = serializeRemotePath(new RoomPosition(anchor.x, anchor.y, home), path);
  const route = toRouteTiles(path);
  (scouted.paths ??= {})[home] = serialized;
  (scouted.route ??= {})[home] = route;
  // A route was found this time — clear any stale negative cache from an earlier failed attempt so a
  // later re-check of this exact scouted object isn't confused by leftover noPathAt state.
  if (scouted.noPathAt) delete scouted.noPathAt[home];
  return { distance: serialized.length, route };
}
