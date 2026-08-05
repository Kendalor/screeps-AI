// Formation-as-data: a Formation is a list of {dx,dy,role} slots relative to an anchor at a canonical
// facing (TOP). slotTiles(anchor, facing, formation) rotates those offsets to any of the 8 compass
// facings — a pure geometric transform, no Game access. Replaces the old hardcoded 2x2 QUADRANT table.

import { describe, expect, it } from "vitest";
import { rotateOffset, slotTiles, type Formation } from "../../../src/lib/formation";
import { range, type XY } from "../../../src/lib/geometry";

// A canonical 2x2 block (anchor at 0,0 + three neighbours) trailing DOWN/RIGHT of the anchor at the
// canonical TOP facing — the shape Drain uses (mutual range-1).
const BLOCK_2X2: Formation = [
  { dx: 0, dy: 0, role: "anchor" },
  { dx: 1, dy: 0, role: "b" },
  { dx: 0, dy: 1, role: "c" },
  { dx: 1, dy: 1, role: "d" }
];

// A 2x3 block (2 wide, 3 tall) — an asymmetric shape whose rotated tile-set does NOT map onto itself,
// used to prove rotation is a real transform, not a special-case for squares.
const BLOCK_2X3: Formation = [
  { dx: 0, dy: 0, role: "anchor" },
  { dx: 1, dy: 0, role: "b" },
  { dx: 0, dy: 1, role: "c" },
  { dx: 1, dy: 1, role: "d" },
  { dx: 0, dy: 2, role: "e" },
  { dx: 1, dy: 2, role: "f" }
];

function isMutualRangeOne(positions: readonly XY[]): boolean {
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      if (i === j) continue;
      if (range(positions[i], positions[j]) > 1) return false;
    }
  }
  return true;
}

describe("rotateOffset", () => {
  it("leaves an offset unchanged at the canonical TOP facing", () => {
    expect(rotateOffset({ dx: 1, dy: 2 }, TOP)).toEqual({ dx: 1, dy: 2 });
  });

  it("rotates 90 degrees clockwise for RIGHT (dx,dy) -> (-dy,dx)", () => {
    // A slot one tile "below" the anchor (dy:1) at TOP ends up one tile "left" (dx:-1) once the whole
    // formation faces RIGHT — a rigid 90-degree clockwise rotation of the offset vector.
    expect(rotateOffset({ dx: 0, dy: 1 }, RIGHT)).toEqual({ dx: -1, dy: 0 });
  });

  it("rotates 180 degrees for BOTTOM (dx,dy) -> (-dx,-dy)", () => {
    expect(rotateOffset({ dx: 1, dy: 2 }, BOTTOM)).toEqual({ dx: -1, dy: -2 });
  });

  it("rotates 270 degrees for LEFT (dx,dy) -> (dy,-dx)", () => {
    expect(rotateOffset({ dx: 0, dy: 1 }, LEFT)).toEqual({ dx: 1, dy: 0 });
  });

  it("supports all 8 facings distinctly (not collapsed to 4) for a point 2 tiles out on both axes", () => {
    const dirs: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
    const seen = new Set<string>();
    for (const d of dirs) {
      // (2,2) is 45 degrees off-axis, so every 45-degree facing lands it on a distinct grid tile — the
      // clean way to show all 8 facings are honoured, not the 4-orientation collapse a strict 2x2 needs.
      const r = rotateOffset({ dx: 2, dy: 2 }, d);
      seen.add(`${r.dx},${r.dy}`);
    }
    // 8 distinct facings produce 8 distinct rotations — the collapse to 4, if a formation needs it, is
    // that formation's own concern, not baked into the generic rotation math.
    expect(seen.size).toBe(8);
  });
});

describe("slotTiles", () => {
  it("places slots at anchor + offset at the canonical TOP facing", () => {
    const tiles = slotTiles({ x: 25, y: 25, room: "W1N1" }, TOP, BLOCK_2X2);
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toEqual({ x: 25, y: 25, room: "W1N1", role: "anchor" });
    expect(tiles[1]).toEqual({ x: 26, y: 25, room: "W1N1", role: "b" });
    expect(tiles[2]).toEqual({ x: 25, y: 26, room: "W1N1", role: "c" });
    expect(tiles[3]).toEqual({ x: 26, y: 26, room: "W1N1", role: "d" });
  });

  // A strict corner-anchored 2x2 stays a valid mutual-range-1 block only at the 4 AXIS-ALIGNED facings —
  // a 45-degree diagonal rotation of an axis-aligned offset lands off-grid and, once snapped, splays the
  // block past range 1. That's why a 2x2 formation must collapse the 8 travel directions onto its 4
  // orientations in its OWN facing-selection (ADR 0007) rather than the generic rotation math hiding it.
  it("keeps a 2x2 a mutual-range-1 block at each of the 4 axis-aligned facings", () => {
    const dirs: DirectionConstant[] = [TOP, RIGHT, BOTTOM, LEFT];
    for (const d of dirs) {
      const tiles = slotTiles({ x: 25, y: 25, room: "W1N1" }, d, BLOCK_2X2);
      expect(isMutualRangeOne(tiles)).toBe(true);
    }
  });

  it("a 2x2 rotated about its anchor corner occupies a DIFFERENT 4-tile set per axis-aligned facing", () => {
    const anchor = { x: 25, y: 25, room: "W1N1" };
    const key = (tiles: { x: number; y: number }[]) =>
      tiles
        .map(t => `${t.x},${t.y}`)
        .sort()
        .join("|");
    // The anchor stays put; the block trails into a different quadrant per facing (the same
    // leader-at-corner behaviour the old QUADRANT table produced). So the tile-set genuinely changes —
    // reform is still solved by greedy assignment, never by assuming the tile-set is invariant.
    const sets = new Set([
      key(slotTiles(anchor, TOP, BLOCK_2X2)),
      key(slotTiles(anchor, RIGHT, BLOCK_2X2)),
      key(slotTiles(anchor, BOTTOM, BLOCK_2X2)),
      key(slotTiles(anchor, LEFT, BLOCK_2X2))
    ]);
    expect(sets.size).toBe(4);
  });

  it("a 2x3's rotated tile-SET differs after a 90-degree turn (an asymmetric shape does NOT map onto itself)", () => {
    const anchor = { x: 25, y: 25, room: "W1N1" };
    const key = (tiles: { x: number; y: number }[]) =>
      tiles
        .map(t => `${t.x},${t.y}`)
        .sort()
        .join("|");
    // The 2-wide/3-tall footprint rotated 90 degrees becomes 3-wide/2-tall — a genuinely different set of
    // tiles, only partially overlapping the original. This is the multi-tick-reshape case.
    expect(key(slotTiles(anchor, TOP, BLOCK_2X3))).not.toBe(key(slotTiles(anchor, RIGHT, BLOCK_2X3)));
  });

  it("carries each slot's role onto its tile so callers can match a creep's role to a slot", () => {
    const tiles = slotTiles({ x: 10, y: 10, room: "W2N2" }, RIGHT, BLOCK_2X2);
    expect(tiles.map(t => t.role).sort()).toEqual(["anchor", "b", "c", "d"]);
  });
});
