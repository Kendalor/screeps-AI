// Footprint-fit route search for a whole squad (ADR 0007, revised per its follow-up plan). A candidate
// anchor tile is only valid if the ENTIRE formation footprint fits there, on walkable/unoccupied terrain,
// regardless of how many slots are currently occupied. Routing itself is now real `PathFinder.search` over a
// cached, moving-maximum-transformed CostMatrix (squadCostMatrix.ts) — a cell's cost already encodes "does
// the whole footprint fit here," so a single-point search is a correct footprint-fit route with no separate
// augmented state space needed. This replaces the module's original bespoke (x, y, room, facing) A*.
//
// `facing` is now a PASS-THROUGH concern, not a pathing one: the moving-maximum matrix is built at a single
// fixed orientation (the formation's own dx/dy axes, unrotated), so this module never searches over facing
// or emits a "reform edge" — every step of a route carries the SAME facing it started with. Orientation
// changes are a placement/action-planning concern layered on top by the caller (see lib/squad.ts's
// SquadState.facing and formation.ts's slotTiles) — a formation needing to reorient mid-route to fit a
// corridor is out of scope here (accepted tradeoff for the 2x2/1x2 formations this codebase currently uses).
// Pure: plain XY/terrain in, path steps out, no Game access beyond PathFinder itself.

import type { Formation } from "./formation";
import { roomAndLocal, worldOf, type XY } from "./geometry";
import { footprintSize, getSquadMatrix, type OccupancySource, type TerrainSource } from "./squadCostMatrix";

export type { OccupancySource, TerrainSource };
export { NO_OCCUPANCY } from "./squadCostMatrix";

export interface SquadAnchor extends XY {
  room: string;
}

export interface SquadPathStep {
  anchor: SquadAnchor;
  facing: DirectionConstant;
}

// PathFinder's own plain/swamp costing — the squad matrix (squadCostMatrix.ts) only ever encodes
// impassable-or-not (0xff or clear); ordinary tile preference among clear tiles is PathFinder's job via
// these options, same convention lib/remotePath.ts's findRemotePath already uses.
const PLAIN_COST = 1;
const SWAMP_COST = 5;
const MAX_ROOMS = 16;
// PathFinder's own default (2000) is tuned for a single-point search over ordinary terrain — the
// moving-maximum matrix (squadCostMatrix.ts) "smears" every wall/edge-overflow cell across the formation's
// whole footprint window, which widens the effective maze around any real choke point (confirmed live,
// 2026-08-08: a squad stalled indefinitely at a room's own edge, `result.incomplete` even though an
// unobstructed route existed — a real terrain wall a couple of tiles off the edge inflated the search past
// the default op budget before it could find the route through, well under this cap once raised).
const MAX_OPS = 20000;

/** Whether the whole formation footprint fits (every slot on walkable, unoccupied ground) with its anchor
 * at `anchor`. Delegates to the SAME cached moving-maximum matrix `findSquadPath` routes over (via
 * squadCostMatrix.ts's getSquadMatrix) rather than a second, separate walkability check — a cell cost of
 * 0xff there already means exactly "the full footprint doesn't fit here." `now` is the caller's current
 * tick, threaded through to the cache exactly like getSquadMatrix's own parameter. */
function footprintFitsAt(anchor: SquadAnchor, formation: Formation, terrain: TerrainSource, occupancy: OccupancySource, now: number): boolean {
  const matrix = getSquadMatrix(anchor.room, formation, terrain, occupancy, now);
  return matrix.get(anchor.x, anchor.y) !== 0xff;
}

// A cap on how far out nearestFittingAnchor searches (Chebyshev radius in tiles) before giving up. A squad
// that fits nowhere within this radius is treated the same as "no route" elsewhere in this module — a
// bounded search, not an unbounded spiral, since a genuinely fit-nowhere pocket is a wall-off, not a gap
// that widens if searched further.
const NEAREST_FIT_RADIUS = 15;

/** The nearest anchor tile (by Chebyshev ring, ties broken by search order) where the WHOLE formation
 * footprint fits, searching outward from `from`. Exists for the case a squad's live position no longer fits
 * its own formation — not a bug, an always-possible state (a straggler drifted off under independent
 * movement before joining, a member died and the degraded shape's anchor inference lands somewhere odd,
 * enemy action shoved a member) — the squad must be able to notice "nowhere near me fits" and walk toward a
 * place that does, rather than reforming forever onto slot tiles that can never all be simultaneously
 * occupied. Returns undefined if nothing within NEAREST_FIT_RADIUS fits. Checks `from` itself first (ring 0)
 * so an already-fitting position is returned immediately.
 *
 * Facing is no longer searched here (see module header) — the caller's `formation` is assumed already
 * expressed at whatever facing it currently wants (formation.ts's slotTiles/rotateOffset having already been
 * applied upstream by the caller, e.g. lib/squad.ts), so this only ever answers "where," never "which way." */
export function nearestFittingAnchor(
  from: SquadAnchor,
  formation: Formation,
  terrain: TerrainSource,
  occupancy: OccupancySource,
  now: number
): SquadAnchor | undefined {
  const s = worldOf(from.x, from.y, from.room);
  for (let radius = 0; radius <= NEAREST_FIT_RADIUS; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        // Only the current ring's perimeter — smaller radii were already tried on earlier iterations.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const { room, x, y } = roomAndLocal(s.wx + dx, s.wy + dy);
        const candidate = { x, y, room };
        if (footprintFitsAt(candidate, formation, terrain, occupancy, now)) return candidate;
      }
    }
  }
  return undefined;
}

/** A footprint-fit route from `start` to a tile within range 1 of `goal` (a full footprint fit exactly at
 * the goal isn't required — the squad only needs to reach it). Returns the ordered path of anchor waypoints,
 * each carrying `start.facing` unchanged (see module header — no reform edges, no facing search), or
 * undefined when no route lets the whole formation footprint fit end to end.
 *
 * Routes via real `PathFinder.search` over the cached moving-maximum matrix (squadCostMatrix.ts) — a
 * `roomCallback` returns that matrix per room the search visits, so multi-room routing (including crossing a
 * room border) is handled entirely by PathFinder's own native mechanism, not by any bespoke cross-room state
 * space (the module's original design). `now` is the caller's current tick, threaded through to the cache.*/
export function findSquadPath(
  start: { anchor: SquadAnchor; facing: DirectionConstant },
  goal: SquadAnchor,
  formation: Formation,
  terrain: TerrainSource,
  occupancy: OccupancySource,
  now: number
): SquadPathStep[] | undefined {
  const result = PathFinder.search(
    new RoomPosition(start.anchor.x, start.anchor.y, start.anchor.room),
    { pos: new RoomPosition(goal.x, goal.y, goal.room), range: 1 },
    {
      plainCost: PLAIN_COST,
      swampCost: SWAMP_COST,
      maxRooms: MAX_ROOMS,
      maxOps: MAX_OPS,
      roomCallback: (roomName: string) => getSquadMatrix(roomName, formation, terrain, occupancy, now)
    }
  );
  if (result.incomplete) return undefined;

  // PathFinder's path excludes the origin — reconstruct the full step list (origin included) so callers see
  // a consistent "current position is step 0" shape, matching the module's original contract.
  const steps: SquadPathStep[] = [{ anchor: start.anchor, facing: start.facing }];
  for (const pos of result.path) steps.push({ anchor: { x: pos.x, y: pos.y, room: pos.roomName }, facing: start.facing });
  return steps;
}
