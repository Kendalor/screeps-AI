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

  it("offsets the anchor within the box when a slot trails BEHIND the anchor (negative offset)", () => {
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

  it("prices (not blocks) the room edge for a footprint that would need a tile off the matrix's own room", () => {
    // A 2x2 anchored at x=49 would need x=50, which doesn't exist in THIS room's matrix — the true fit is
    // un-verifiable without peeking at the neighboring room's terrain (forbidden, no cross-room position
    // math in this module). A HIGH-BUT-FINITE cost (not 0xff/impassable) is used instead: an exit tile
    // always opens onto real walkable ground a tile or two into the neighboring room (a Screeps engine
    // guarantee — exits never open onto a dead end), so refusing to ever route the anchor there at all would
    // make EVERY room border structurally uncrossable for a corner-anchored formation like BLOCK_2X2, in ANY
    // facing (confirmed live via a real-engine integration test before this was fixed) — worse than the
    // bounded, occasional risk of guessing wrong about the far side. Still real cost, clearly more expensive
    // than any genuinely fitting in-room tile, so PathFinder only reaches for it as a last resort.
    const terrain: TerrainSource = room => (room === "W1N1" ? openTerrain() : undefined);
    const matrix = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 0);
    expect(matrix.get(49, 25)).toBeGreaterThan(1);
    expect(matrix.get(49, 25)).toBeLessThan(0xff);
    expect(matrix.get(25, 49)).toBeGreaterThan(1);
    expect(matrix.get(25, 49)).toBeLessThan(0xff);
    expect(matrix.get(25, 25)).toBe(0); // deep interior: no edge-overflow cost at all
  });

  it("keeps a REAL wall impassable even when the same footprint window also touches the room-edge overflow", () => {
    // Anchored at (49,25) (BLOCK_2X2's window there already needs the off-room x=50 column, priced per the
    // test above) — but (49,26), one of that SAME window's own in-room slots, is a genuine wall. The window
    // must still read as fully impassable: an overflow cell's finite cost must never mask a real, verifiable
    // in-room obstacle that happens to share the same window.
    const terrain: TerrainSource = room => (room === "W1N1" ? terrainWithWalls([[49, 26]]) : undefined);
    const matrix = getSquadMatrix("W1N1", BLOCK_2X2, terrain, NO_OCCUPANCY, 0);
    expect(matrix.get(49, 25)).toBe(0xff);
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

  it("does not share a cache entry across different rooms", () => {
    const terrainA: TerrainSource = room => (room === "W1N1" ? terrainWithWalls([[10, 10]]) : undefined);
    const terrainB: TerrainSource = room => (room === "W2N1" ? openTerrain() : undefined);
    const a = getSquadMatrix("W1N1", BLOCK_2X2, terrainA, NO_OCCUPANCY, 0);
    const b = getSquadMatrix("W2N1", BLOCK_2X2, terrainB, NO_OCCUPANCY, 0);
    expect(a.get(10, 10)).toBe(0xff);
    expect(b.get(10, 10)).not.toBe(0xff);
  });
});
