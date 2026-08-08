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
  // `+ 0` normalizes a rounded -0 back to 0 (minDx/minDy of 0 negated is -0) — matches formation.ts's
  // rotateOffset's own convention so equality checks never distinguish the two.
  return { width: maxDx - minDx + 1, height: maxDy - minDy + 1, anchorDx: -minDx + 0, anchorDy: -minDy + 0 };
}

// Cost convention mirrors traveler.ts's addStructuresToMatrix: 0xff = impassable, else a plain-terrain cost
// cheap enough that PathFinder's own plainCost/swampCost options (set by the caller, see squadPath.ts once
// Step 2 lands) still dominate ordinary tile preference — this matrix's job is ONLY to encode "does the
// footprint fit here," not to re-litigate plains-vs-swamp costing.
const IMPASSABLE = 0xff;

// The cost applied to an anchor slot whose footprint would need a tile PAST this room's own 50x50 grid — a
// window overflow, not a real wall (see applyMovingMaximum's doc). Genuinely IMPASSABLE (0xff) here means
// PathFinder can NEVER route the anchor onto this room's own edge column/row in the overflow direction —
// which, for a corner-anchored formation (any facing of DRAIN_FORMATION's trailing 2x2), is EVERY facing's
// SAME edge in BOTH the room being left and the room being entered (the shape doesn't change mid-route), so
// a strict-impassable edge makes every room border structurally uncrossable in any facing — confirmed via a
// real-engine integration test (test/integration/drain-squad-border-crossing.test.ts) before this was fixed.
// A HIGH-BUT-FINITE cost instead lets PathFinder use the edge only when nothing better exists (a genuine
// border crossing), while still strongly preferring any route that doesn't need it. This is a deliberate,
// bounded correctness trade — this room's matrix genuinely cannot verify the footprint fits in the
// NEIGHBORING room without peeking at its terrain (forbidden by this module's cross-room hard constraint,
// see the module header) — justified by a real Screeps engine guarantee: an exit tile always opens onto real
// walkable ground at least a tile or two into the neighboring room (exits never open directly onto a
// corner/dead-end), so a small formation (a 2x2, the only shape this codebase currently uses) landing just
// past a border is safe in practice, not a real gamble. Sized well above PLAIN_COST/SWAMP_COST so PathFinder
// only reaches for this as a last resort, never as a shortcut past genuinely cheaper in-room routes.
const ROOM_EDGE_OVERFLOW_COST = 50;

function baseCostMatrix(room: string, terrain: TerrainSource, occupancy: OccupancySource): CostMatrix {
  const matrix = new PathFinder.CostMatrix();
  const t = terrain(room);
  const o = occupancy(room);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const blocked = (t && t[x * 50 + y] !== 1) || (o && o[x * 50 + y] === 1);
      if (blocked) matrix.set(x, y, IMPASSABLE);
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
 * Deliberately room-local only, no cross-room lookups: a window that overflows this room's own 50x50 grid
 * costs ROOM_EDGE_OVERFLOW_COST HERE (a real, un-verifiable-without-peeking wall might be there — but might
 * just as well be open ground one tile into the neighboring room — see that constant's own doc for why a
 * high-but-finite cost, not IMPASSABLE, is the right call) — border crossing itself is still
 * PathFinder.search's job (its own native per-room roomCallback stitching across a route), not something
 * this single-room matrix pre-solves by peeking at a neighbor; it just no longer forecloses the possibility
 * outright. A genuinely BLOCKED in-room tile (real terrain/occupancy, `matrix.get` already IMPASSABLE) stays
 * IMPASSABLE regardless of whether the SAME window also touches an overflow cell — `Math.min(worst,
 * IMPASSABLE)` below caps the window's cost, but a window is only capped there if literally every cell in it
 * scored IMPASSABLE already; an overflow cell alone never promotes a window past ROOM_EDGE_OVERFLOW_COST, and
 * a real wall inside the window still wins the max (worst) over any overflow cell, staying IMPASSABLE. Matches
 * Overmind's own applyMovingMaximum in spirit (confirmed from source) and the instruction this module
 * follows: let PathFinder handle route/room transitions, never hand-roll cross-room position math — this
 * only prices the uncertainty at a border, it doesn't resolve it by computing anything cross-room itself. */
function applyMovingMaximum(matrix: CostMatrix, width: number, height: number, anchorDx: number, anchorDy: number): CostMatrix {
  const out = new PathFinder.CostMatrix();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      let worst = 0;
      for (let dx = -anchorDx; dx < width - anchorDx && worst < IMPASSABLE; dx++) {
        for (let dy = -anchorDy; dy < height - anchorDy && worst < IMPASSABLE; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          const cost = nx < 0 || nx >= 50 || ny < 0 || ny >= 50 ? ROOM_EDGE_OVERFLOW_COST : matrix.get(nx, ny);
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
 * testable without a live Game global). Cache key includes the footprint's (width, height, anchorDx, anchorDy)
 * — two formations with the same bounding box AND the same anchor-slot offset within it (e.g. any two 2x2s
 * at the same facing) share a cache entry, matching how the matrix itself only ever encodes "does a box this
 * size, anchored here, fit" — but anchorDx/anchorDy must be part of the key too: a formation rotated to a
 * different facing keeps the same (width, height) yet the anchor slot can sit at a DIFFERENT corner of that
 * box (e.g. BOTTOM-facing BLOCK_2X2 anchors its bottom-right corner, not its top-left), which needs a
 * differently-shifted moving-maximum window (see applyMovingMaximum's doc) — omitting anchorDx/anchorDy from
 * the key would silently serve one facing's matrix to another. */
export function getSquadMatrix(
  room: string,
  formation: Formation,
  terrain: TerrainSource,
  occupancy: OccupancySource,
  now: number
): CostMatrix {
  const { width, height, anchorDx, anchorDy } = footprintSize(formation);
  const key = `${room}:${width}x${height}:${anchorDx},${anchorDy}`;
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
