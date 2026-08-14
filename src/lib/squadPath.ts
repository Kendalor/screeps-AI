// Footprint-fit route search for a whole squad (ADR 0007, revised per its follow-up plan). A candidate
// anchor tile is only valid if the ENTIRE formation footprint fits there, on walkable/unoccupied terrain,
// regardless of how many slots are currently occupied. Routing itself is now real `PathFinder.search` over a
// cached, moving-maximum-transformed CostMatrix (squadCostMatrix.ts) — a cell's cost already encodes "does
// the whole footprint fit here," so a single-point search is a correct footprint-fit route with no separate
// augmented state space needed. This replaces the module's original bespoke (x, y, room, facing) A*.
//
// `facing` never reaches this module at all — not even as a pass-through. Every squad formation is required
// (formation.ts's assertSquareTopLeftAnchor) to have a SQUARE bounding box with its anchor fixed at the
// box's own top-left corner, which makes the footprint's tile-set relative to the anchor IDENTICAL at every
// facing — so pathing only ever needs a formation's {width, height}, never which way it's currently facing.
// Orientation is purely a placement/action-planning concern layered on top by the caller (see lib/squad.ts's
// SquadState.facing and formation.ts's slotTiles) — this module doesn't search over facing, doesn't emit a
// "reform edge," and doesn't need to carry a facing value through its own route steps at all.
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
 * tick, threaded through to the cache exactly like getSquadMatrix's own parameter.
 *
 * Also rejects an anchor whose OWN footprint would need a tile past this room's own 50x50 grid — matching
 * Overmind's applyMovingMaximum loop bound exactly (squadCostMatrix.ts never evaluates such an anchor at
 * all, see that module's doc), `matrix.get` on one of those cells returns the CostMatrix default of 0, which
 * would otherwise read as "fits" (0 !== 0xff) even though the anchor is genuinely out of bounds for this
 * formation's shape — confirmed live as a real gap (2026-08-08) once the fabricated finite "overflow" cost
 * this function used to rely on for the SAME purpose was reverted. */
function footprintFitsAt(anchor: SquadAnchor, formation: Formation, terrain: TerrainSource, occupancy: OccupancySource, now: number): boolean {
  const { width, height, anchorDx, anchorDy } = footprintSize(formation);
  if (anchor.x < anchorDx || anchor.x > 50 - width + anchorDx) return false;
  if (anchor.y < anchorDy || anchor.y > 50 - height + anchorDy) return false;
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
 * There is no facing to search here at all (see module header) — `formation`'s tile-set is fixed, full
 * stop (formation.ts's module header), so this only ever answers "where," never "which way." */
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
 * or undefined when no route lets the whole formation footprint fit end to end.
 *
 * Routes via real `PathFinder.search` over the cached moving-maximum matrix (squadCostMatrix.ts) — a
 * `roomCallback` returns that matrix per room the search visits, so multi-room routing (including crossing a
 * room border) is handled entirely by PathFinder's own native mechanism, not by any bespoke cross-room state
 * space (the module's original design). `now` is the caller's current tick, threaded through to the cache.*/
export function findSquadPath(
  start: SquadAnchor,
  goal: SquadAnchor,
  formation: Formation,
  terrain: TerrainSource,
  occupancy: OccupancySource,
  now: number
): SquadPathStep[] | undefined {
  const result = PathFinder.search(
    new RoomPosition(start.x, start.y, start.room),
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
  const steps: SquadPathStep[] = [{ anchor: start }];
  for (const pos of result.path) steps.push({ anchor: { x: pos.x, y: pos.y, room: pos.roomName } });
  return steps;
}
