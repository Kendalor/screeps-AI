// squadCostMatrix: the cached, moving-maximum-transformed CostMatrix that replaces squadPath.ts's bespoke
// per-tick footprint-fit A* (see docs/adr/0007-squad-movement.md's follow-up plan, Step 1). Pure geometry +
// a TTL cache — no Game access beyond the globally-stubbed PathFinder.CostMatrix (test/constants.ts).

import { beforeEach, describe, expect, it } from "vitest";
import { clearSquadMatrixCache, footprintSize, getSquadMatrix, type OccupancySource, type TerrainSource } from "../../../src/lib/squadCostMatrix";
import type { Formation } from "../../../src/lib/formation";

const BLOCK_2X2: Formation = [
  { dx: 0, dy: 0, role: "a" },
  { dx: 1, dy: 0, role: "b" },
  { dx: 0, dy: 1, role: "c" },
  { dx: 1, dy: 1, role: "d" }
];

const LINE_1X2: Formation = [
  { dx: 0, dy: 0, role: "a" },
  { dx: 0, dy: 1, role: "b" }
];

function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}

function terrainWithWalls(walls: [number, number][]): Uint8Array {
  const t = openTerrain();
  for (const [x, y] of walls) t[x * 50 + y] = 0;
  return t;
}

const NO_OCCUPANCY: OccupancySource = () => undefined;

beforeEach(() => {
  clearSquadMatrixCache();
});

describe("footprintSize", () => {
  it("reports a 2x2 block's bounding box with the anchor at the box's own top-left corner", () => {
    expect(footprintSize(BLOCK_2X2)).toEqual({ width: 2, height: 2, anchorDx: 0, anchorDy: 0 });
  });

  it("reports a vertical 1x2 line's bounding box (width 1, height 2)", () => {
    expect(footprintSize(LINE_1X2)).toEqual({ width: 1, height: 2, anchorDx: 0, anchorDy: 0 });
  });

  // NOTE: every squad formation actually in use is now REQUIRED to be square with the anchor fixed at the
  // box's own top-left corner (formation.ts's assertSquareTopLeftAnchor, docs/adr/0007-squad-movement.md's
  // follow-up) — this shape (a slot trailing BEHIND the anchor) can no longer arise from a real formation.
  // Kept anyway to protect footprintSize's general windowed-max geometry from bitrotting silently: nothing
  // else exercises the nonzero anchorDx/anchorDy branch once every real formation is square/corner-anchored,
  // but the mechanism itself (and applyMovingMaximum's shift parameters) stays available for a future
  // formation type that might legitimately need an off-corner anchor again.
  it("offsets the anchor within the box when a slot trails BEHIND the anchor (mechanism test, not a shape any real formation may use)", () => {
    const trailing: Formation = [
      { dx: 0, dy: 0, role: "anchor" },
      { dx: -1, dy: 0, role: "trailer" }
    ];
    expect(footprintSize(trailing)).toEqual({ width: 2, height: 1, anchorDx: 1, anchorDy: 0 });
  });
});

describe("getSquadMatrix", () => {
  it("reports a cell blocked (cost 0xff) iff ANY tile in the footprint's window anchored there is blocked", () => {
    // A single wall at (5,5). A 2x2 footprint anchored at (5,5), (4,5), (5,4), or (4,4) all touch it.
    const terrain: TerrainSource = room => (room === "W1N1" ? terrainWithWalls([[5, 5]]) : undefined);
    const matrix = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 0);
    expect(matrix.get(5, 5)).toBe(0xff); // anchor exactly on the wall
    expect(matrix.get(4, 5)).toBe(0xff); // wall is the anchor's (dx=1,dy=0) slot
    expect(matrix.get(5, 4)).toBe(0xff); // wall is the anchor's (dx=0,dy=1) slot
    expect(matrix.get(4, 4)).toBe(0xff); // wall is the anchor's (dx=1,dy=1) slot
    // One tile further away in either axis, the footprint no longer reaches the wall at all.
    expect(matrix.get(6, 5)).not.toBe(0xff);
    expect(matrix.get(5, 6)).not.toBe(0xff);
    expect(matrix.get(3, 5)).not.toBe(0xff);
  });

  it("treats a live-occupied tile the same as a wall for footprint-fit purposes", () => {
    const terrain: TerrainSource = room => (room === "W1N1" ? openTerrain() : undefined);
    const occupancy: OccupancySource = room => {
      if (room !== "W1N1") return undefined;
      const grid = new Uint8Array(2500);
      grid[10 * 50 + 10] = 1; // a bystander creep at (10,10)
      return grid;
    };
    const matrix = getSquadMatrix("W1N1", BLOCK_2X2, terrain, occupancy, 0);
    expect(matrix.get(10, 10)).toBe(0xff);
    expect(matrix.get(9, 9)).toBe(0xff); // footprint anchored here would cover (10,10)
    expect(matrix.get(8, 8)).not.toBe(0xff); // too far away to reach the occupied tile
  });

  it("never evaluates an anchor whose footprint would need a tile off the matrix's own room (matches Overmind's own applyMovingMaximum loop bound exactly)", () => {
    // A 2x2 anchored at x=49 would need x=50, which doesn't exist in THIS room's matrix. An earlier version
    // of this file priced that case at a fabricated finite "overflow" cost instead of leaving it unevaluated
    // — confirmed live (2026-08-08, colony W5N3's drain squad) to make PathFinder prefer bailing out the
    // WRONG edge of a room (straight back the way it came) over a genuinely cheaper detour around an
    // interior obstacle, because every room edge looked like a similarly-priced shortcut, not just the one
    // actually being crossed. Reverted to match Overmind's real Pathing.ts source exactly: applyMovingMaximum
    // simply never evaluates x=49/y=49 for a 2-wide/2-tall footprint (out.get on an unset cell reads 0, i.e.
    // "unconstrained by this matrix" — not impassable, not specially priced either). Border-crossing itself
    // is instead enabled by EXIT_COST (see the next test): real edge tiles get a small, genuine per-tile
    // cost, smeared inward by the SAME moving-maximum window over in-bounds cells, so an anchor a
    // footprint-width back from the edge already reads the exit's true cost.
    const terrain: TerrainSource = room => (room === "W1N1" ? openTerrain() : undefined);
    const matrix = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 0);
    expect(matrix.get(49, 25)).toBe(0);
    expect(matrix.get(25, 49)).toBe(0);
    expect(matrix.get(25, 25)).toBe(0); // deep interior: no edge cost at all
  });

  it("smears EXIT_COST inward from real (non-wall) room-edge tiles via the same moving-maximum window", () => {
    // The LAST anchor position applyMovingMaximum actually evaluates before the edge (x=48 for a 2-wide
    // footprint anchored top-left) already sees the real exit tile at x=49 inside its own window, so its
    // cost reads as EXIT_COST (10) — cheap enough that PathFinder only mildly prefers a genuinely open
    // interior route over it, matching Overmind's own default exitCost (Pathing.ts's setExitCosts).
    const terrain: TerrainSource = room => (room === "W1N1" ? openTerrain() : undefined);
    const matrix = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 0);
    expect(matrix.get(48, 25)).toBe(10);
    expect(matrix.get(25, 48)).toBe(10);
    expect(matrix.get(47, 25)).toBe(0); // one further back: outside the footprint's reach of the edge
  });

  it("keeps a REAL wall impassable even when the same footprint window also touches a smeared exit cost", () => {
    // Anchored at (48,25) (BLOCK_2X2's window there already touches the real exit tile x=49, priced
    // EXIT_COST per the test above) — but (49,26), one of that SAME window's own in-room slots, is a
    // genuine wall. The window must still read as fully impassable: a smeared exit cost must never mask a
    // real, verifiable in-room obstacle that happens to share the same window.
    const terrain: TerrainSource = room => (room === "W1N1" ? terrainWithWalls([[49, 26]]) : undefined);
    const matrix = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 0);
    expect(matrix.get(48, 25)).toBe(0xff);
  });

  it("caches the matrix across calls within the TTL window (same object returned)", () => {
    const terrain: TerrainSource = room => (room === "W1N1" ? openTerrain() : undefined);
    const first = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 100);
    const second = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 105);
    expect(second).toBe(first);
  });

  it("rebuilds once the TTL has elapsed, picking up terrain that changed in between", () => {
    let wallAdded = false;
    const terrain: TerrainSource = room => (room === "W1N1" ? (wallAdded ? terrainWithWalls([[10, 10]]) : openTerrain()) : undefined);

    const first = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 0);
    expect(first.get(10, 10)).not.toBe(0xff);

    wallAdded = true;
    const stillCached = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 5);
    expect(stillCached.get(10, 10)).not.toBe(0xff); // TTL not elapsed yet — stale matrix still returned

    const rebuilt = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 25);
    expect(rebuilt.get(10, 10)).toBe(0xff); // TTL elapsed — picks up the new wall
  });

  it("keys the cache by room AND footprint shape (a 1x2 and a 2x2 in the same room don't share an entry)", () => {
    const terrain: TerrainSource = room => (room === "W1N1" ? terrainWithWalls([[10, 11]]) : undefined);
    const block = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 0);
    const line = getSquadMatrix("W1N1", LINE_1X2, terrain, NO_OCCUPANCY, 0);
    // The 2x2 anchored at (10,10) covers the wall at (10,11) (dy=1 slot); the 1x2 line anchored at (10,10)
    // also covers it (dy=1 slot) — both blocked here, but confirm they're genuinely different matrix
    // objects (not accidentally sharing one cache entry across different shapes).
    expect(block.get(10, 10)).toBe(0xff);
    expect(line.get(10, 10)).toBe(0xff);
    expect(block).not.toBe(line);
  });

  it("shares ONE cache entry across formations of the same size regardless of anchor offset within the box (facing-invariant cache key)", () => {
    // Simulates what a rotated formation used to look like BEFORE the square/top-left-anchor constraint:
    // same bounding box (2x1), but the anchor at a different corner (anchorDx:1 instead of 0). The cache key
    // is now `${room}:${width}x${height}` only — these two formations must share the SAME matrix object,
    // since pathing no longer needs to know which corner of the box the anchor sits at (every real formation
    // has it fixed at (0,0) regardless of facing — see formation.ts's assertSquareTopLeftAnchor).
    const cornerAnchor: Formation = [
      { dx: 0, dy: 0, role: "anchor" },
      { dx: 1, dy: 0, role: "b" }
    ];
    const offCornerAnchor: Formation = [
      { dx: 0, dy: 0, role: "anchor" },
      { dx: -1, dy: 0, role: "b" }
    ];
    const terrain: TerrainSource = room => (room === "W1N1" ? openTerrain() : undefined);
    const a = getSquadMatrix("W1N1", cornerAnchor, terrain, NO_OCCUPANCY, 0);
    const b = getSquadMatrix("W1N1", offCornerAnchor, terrain, NO_OCCUPANCY, 0);
    expect(a).toBe(b);
  });

  it("does not share a cache entry across different rooms", () => {
    const terrainA: TerrainSource = room => (room === "W1N1" ? terrainWithWalls([[10, 10]]) : undefined);
    const terrainB: TerrainSource = room => (room === "W2N1" ? openTerrain() : undefined);
    const a = getSquadMatrix("W1N1", BLOCK_2X2, terrainA, NO_OCCUPANCY, 0);
    const b = getSquadMatrix("W2N1", BLOCK_2X2, terrainB, NO_OCCUPANCY, 0);
    expect(a.get(10, 10)).toBe(0xff);
    expect(b.get(10, 10)).not.toBe(0xff);
  });
});
