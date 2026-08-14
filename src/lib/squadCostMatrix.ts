// A cached, per-room CostMatrix for a squad's footprint shape (Overmind's "moving maximum" trick, adapted —
// see docs/adr/0007-squad-movement.md's follow-up plan). A cell's cost is rewritten to the MAX cost found
// anywhere in the formation's width x height window anchored at that cell, so a single-point PathFinder.search
// over the transformed matrix is already a correct footprint-fit search: a cell is only cheap if the WHOLE
// footprint fits there. This replaces squadPath.ts's bespoke per-tick footprint-fit A* with one cached matrix
// per (room, formation shape), built the same way findRemotePath (lib/remotePath.ts) and Traveler's own
// getStructureMatrix (lib/traveler.ts) already cache PathFinder.CostMatrix objects — no new caching
// abstraction invented here.
//
// Deliberately does NOT know about facing/rotation: the moving-maximum window is built at a single fixed
// orientation (width x height in the formation's own dx/dy axes, not rotated). A formation that needs to
// change orientation mid-route to fit a corridor is out of scope for this matrix (see ADR follow-up's Step 3
// — facing is decoupled from pathing, not solved by rotating the cached matrix).

import type { Formation } from "./formation";

// Vision-independent terrain for a room: 1=walkable, 0=wall, [x*50+y]-indexed (the engine's own layout) —
// same shape as squadPath.ts's TerrainSource, duplicated here rather than imported to keep this module able
// to stand alone (squadPath.ts will import FROM here once Step 2 lands, not the other way around).
export type TerrainSource = (room: string) => Uint8Array | undefined;

// Live occupancy for a room: 1=occupied by a live, non-squad unit this tick, 0=clear. Same shape/convention
// as squadPath.ts's OccupancySource.
export type OccupancySource = (room: string) => Uint8Array | undefined;

export const NO_OCCUPANCY: OccupancySource = () => undefined;

export interface FootprintSize {
  width: number;
  height: number;
  // The formation's own anchor slot's offset within the footprint's bounding box (0,0 is the box's
  // top-left corner) — needed because a formation's anchor slot is not necessarily the box's own corner
  // (e.g. a slot at dx=-1 relative to the anchor puts the anchor one column in from the box's left edge).
  anchorDx: number;
  anchorDy: number;
}

/** The (width, height) bounding box of a Formation's slot offsets, plus where the anchor slot sits within
 * that box. Pure geometry, no rotation — callers needing a rotated footprint (a different facing) call this
 * on a formation whose offsets are already expressed at the facing they care about. */
export function footprintSize(formation: Formation): FootprintSize {
  let minDx = 0;
  let maxDx = 0;
  let minDy = 0;
  let maxDy = 0;
  for (const slot of formation) {
    minDx = Math.min(minDx, slot.dx);
    maxDx = Math.max(maxDx, slot.dx);
    minDy = Math.min(minDy, slot.dy);
    maxDy = Math.max(maxDy, slot.dy);
  }
  // `+ 0` normalizes a rounded -0 back to 0 (minDx/minDy of 0 negated is -0) so equality checks never
  // distinguish the two.
  return { width: maxDx - minDx + 1, height: maxDy - minDy + 1, anchorDx: -minDx + 0, anchorDy: -minDy + 0 };
}

// Cost convention mirrors traveler.ts's addStructuresToMatrix: 0xff = impassable, else a plain-terrain cost
// cheap enough that PathFinder's own plainCost/swampCost options (set by the caller, see squadPath.ts once
// Step 2 lands) still dominate ordinary tile preference — this matrix's job is ONLY to encode "does the
// footprint fit here," not to re-litigate plains-vs-swamp costing.
const IMPASSABLE = 0xff;

// Overmind's own EXIT_COST equivalent (Pathing.ts's setExitCosts, default argument 10) — priced on the RAW,
// pre-moving-maximum matrix, on real room-edge tiles only (x/y ∈ {0,49}) that aren't already a wall. This
// is deliberately NOT the mechanism the first cut of this file used (a fabricated "window overflow" cost
// applied inside applyMovingMaximum for any anchor whose footprint would need an out-of-grid tile) — that
// approach primed EVERY edge of EVERY room as a cheap-ish escape hatch, not just the border actually being
// crossed, and was confirmed live (2026-08-08, colony W5N3's drain squad) to make PathFinder prefer bailing
// out the WRONG edge (straight back into the squad's own home room) over a genuinely available ~85-cost
// detour around an interior wall, because the fabricated overflow cost (50, tuned only against "should be
// more than a plain step" reasoning, never against real detour costs) was cheaper than actually walking
// around the obstacle. Re-read from Overmind's real source (Pathing.ts) to fix this: they price the tile
// ITSELF (not a fictitious tile past it), at a small constant (10 — 2x a swamp step, 10x a plain step) BEFORE
// applyMovingMaximum's window-max pass smears it outward like any other cost. `applyMovingMaximum` still
// never evaluates an anchor whose footprint would need an actually-out-of-bounds tile (see its own doc) —
// matching Overmind's `x <= 50-width` loop bound exactly, no separate overflow branch invented for that case
// at all. The smeared exit cost alone is what lets a footprint's anchor walk right up to (and eventually
// past, via PathFinder's own native per-room roomCallback stitching) a real exit, cheaply but not for free.
const EXIT_COST = 10;

function baseCostMatrix(room: string, terrain: TerrainSource, occupancy: OccupancySource): CostMatrix {
  const matrix = new PathFinder.CostMatrix();
  const t = terrain(room);
  const o = occupancy(room);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const blocked = (t && t[x * 50 + y] !== 1) || (o && o[x * 50 + y] === 1);
      if (blocked) matrix.set(x, y, IMPASSABLE);
      else if (x === 0 || x === 49 || y === 0 || y === 49) matrix.set(x, y, EXIT_COST);
    }
  }
  return matrix;
}

/** Rewrites `matrix` in place so cell (x,y)'s cost becomes the MAX cost found in the `width x height`
 * bounding box that CONTAINS THE ANCHOR SLOT AT (x,y) — Overmind's applyMovingMaximum equivalent, generalized
 * to an anchor slot that isn't necessarily the box's own top-left corner. `anchorDx`/`anchorDy`
 * (footprintSize's own fields) are the anchor's offset FROM the box's top-left corner, so the box actually
 * spans `x - anchorDx .. x - anchorDx + width-1` (and the same for y) — for the canonical BLOCK_2X2
 * (anchorDx=anchorDy=0, the anchor already IS the top-left corner) this collapses to the original
 * top-left-relative window, but a ROTATED formation (e.g. BOTTOM facing negates dx/dy, putting the anchor at
 * the box's BOTTOM-RIGHT corner instead) needs the window shifted accordingly, or cell (x,y) would encode
 * "does a box fit starting here" rather than "does a box fit AROUND my own anchor slot here" — the two only
 * coincide when anchorDx=anchorDy=0. Confirmed live via squadReformDeadlock.test.ts's BOTTOM-facing repro:
 * without this shift, nearestFittingAnchor reported a tile "fitting" by checking the wrong region of the
 * grid entirely, sending members onto an actual wall tile slotTiles' own (correctly rotated) placement
 * would occupy. After this, a plain PathFinder.search treating (x,y) as "my formation's own anchor slot
 * tile" is already a correct footprint-fit search. O(2500 * w * h), trivial for the 2x2/1x2 shapes this
 * codebase uses (ADR 0007 follow-up).
 *
 * Deliberately room-local only, no cross-room lookups: an anchor whose footprint window would need a tile
 * PAST this room's own 50x50 grid is simply never evaluated at all — matching Overmind's own
 * applyMovingMaximum exactly (`x <= 50-width`/`y <= 50-height` loop bounds, confirmed from source), not
 * priced with any fabricated "overflow" cost (an earlier version of this function invented one; see
 * EXIT_COST's doc for why that was wrong and got reverted). Cells outside the evaluated range are left at
 * cost 0 in `out`, which PathFinder reads as "use plainCost/swampCost" — effectively unconstrained by this
 * matrix — but those anchors are already unreachable in practice: they're the room's own literal edge row/
 * column, and EXIT_COST (baseCostMatrix) already primed real exit tiles as smeared-in-cheap by the window
 * pass over IN-BOUNDS cells, so an anchor a full footprint-width back from the edge already reads the exit's
 * cost correctly without this function ever needing to reach past x/y 49 itself. Border crossing is entirely
 * PathFinder.search's own job (its native per-room roomCallback stitching across a route) — this module never
 * computes or guesses anything about a neighboring room. */
function applyMovingMaximum(matrix: CostMatrix, width: number, height: number, anchorDx: number, anchorDy: number): CostMatrix {
  const out = new PathFinder.CostMatrix();
  for (let x = anchorDx; x <= 50 - width + anchorDx; x++) {
    for (let y = anchorDy; y <= 50 - height + anchorDy; y++) {
      let worst = 0;
      for (let dx = -anchorDx; dx < width - anchorDx && worst < IMPASSABLE; dx++) {
        for (let dy = -anchorDy; dy < height - anchorDy && worst < IMPASSABLE; dy++) {
          const cost = matrix.get(x + dx, y + dy);
          if (cost > worst) worst = cost;
        }
      }
      if (worst > 0) out.set(x, y, Math.min(worst, IMPASSABLE));
    }
  }
  return out;
}

interface CacheEntry {
  tick: number;
  matrix: CostMatrix;
}

// Cache key: `${room}:${width}x${height}`. Static module-level cache mirroring Traveler.structureMatrixCache
// (lib/traveler.ts) — never serialized to Memory, rebuilt fresh on every code push same as that cache.
const cache = new Map<string, CacheEntry>();

// How long a cached matrix is trusted before a rebuild — matches remotePath.ts's NO_PATH_RETRY_AFTER's
// reasoning in spirit (cheap insurance against staleness, not a routine per-tick rebuild), sized much
// shorter since THIS cache's staleness risk is live creep occupancy baked into a multi-tick-cached matrix,
// not a one-off pathfind result. Structures/terrain change far less often than this and don't need their
// own separate invalidation signal at this TTL.
const TTL_TICKS = 20;

/** The cached, moving-maximum-transformed CostMatrix for `formation`'s footprint in `room`, built from
 * `terrain` + `occupancy`. Lazily rebuilt on a cache miss or TTL expiry; `now` is the caller's current tick
 * (a parameter, not a direct Game.time read, matching remotePath.ts's pure-function convention so this stays
 * testable without a live Game global).
 *
 * Cache key is `${room}:${width}x${height}` ONLY — every squad formation is now required (formation.ts's
 * assertSquareTopLeftAnchor, docs/adr/0007-squad-movement.md's follow-up) to have a SQUARE bounding box with
 * its anchor slot fixed at the box's own top-left corner (anchorDx=anchorDy=0 always), which makes the
 * footprint's tile-set relative to the anchor identical at every facing — pathing (this module, squadPath.ts)
 * never needs to know a formation's facing at all anymore, so a formation's SIZE alone is enough to key the
 * cache: one matrix per room per formation size, shared across every facing a squad might currently hold,
 * not rebuilt/re-keyed on a facing change. (Before this constraint, an off-corner anchor's box-relative
 * position changed per rotation, so anchorDx/anchorDy had to be part of the key too — see git history on
 * this comment for that version if `applyMovingMaximum`'s shift parameters are ever needed for a
 * non-square/off-corner formation again.) */
export function getSquadMatrix(
  room: string,
  formation: Formation,
  terrain: TerrainSource,
  occupancy: OccupancySource,
  now: number
): CostMatrix {
  const { width, height, anchorDx, anchorDy } = footprintSize(formation);
  const key = `${room}:${width}x${height}`;
  const cached = cache.get(key);
  if (cached && now - cached.tick < TTL_TICKS) return cached.matrix;

  const base = baseCostMatrix(room, terrain, occupancy);
  const matrix = applyMovingMaximum(base, width, height, anchorDx, anchorDy);
  cache.set(key, { tick: now, matrix });
  return matrix;
}

// Test-only: drops every cached entry so successive tests (which reuse room names across cases) never read
// a stale matrix from an earlier test's cache population. Not used by production code.
export function clearSquadMatrixCache(): void {
  cache.clear();
}
