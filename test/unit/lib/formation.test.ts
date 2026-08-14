// Formation-as-data: a Formation is a list of {dx,dy,role} slots, FIXED relative to the anchor — there is
// no facing/rotation concept anywhere at this layer (see src/lib/formation.ts's module header).
// slotTiles(anchor, formation) places those fixed offsets at a concrete anchor tile — a pure geometric
// transform, no Game access. Replaces the old hardcoded 2x2 QUADRANT table.

import { describe, expect, it } from "vitest";
import { assertSquareTopLeftAnchor, parseRectFormation, slotTiles, type Formation } from "../../../src/lib/formation";
import { range, type XY } from "../../../src/lib/geometry";

// A 2x2 block (anchor at 0,0 + three neighbours) trailing DOWN/RIGHT of the anchor — the shape Drain uses
// (mutual range-1).
const BLOCK_2X2: Formation = [
  { dx: 0, dy: 0, role: "anchor" },
  { dx: 1, dy: 0, role: "b" },
  { dx: 0, dy: 1, role: "c" },
  { dx: 1, dy: 1, role: "d" }
];

// A 2x3 block (2 wide, 3 tall) — a non-square shape, used only by assertSquareTopLeftAnchor's own tests
// below (a real formation of this shape is rejected before it can reach slotTiles at all).
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

describe("slotTiles", () => {
  it("places slots at anchor + fixed offset", () => {
    const tiles = slotTiles({ x: 25, y: 25, room: "W1N1" }, BLOCK_2X2);
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toEqual({ x: 25, y: 25, room: "W1N1", role: "anchor" });
    expect(tiles[1]).toEqual({ x: 26, y: 25, room: "W1N1", role: "b" });
    expect(tiles[2]).toEqual({ x: 25, y: 26, room: "W1N1", role: "c" });
    expect(tiles[3]).toEqual({ x: 26, y: 26, room: "W1N1", role: "d" });
  });

  it("keeps a 2x2 a mutual-range-1 block regardless of anchor position", () => {
    for (const anchor of [
      { x: 25, y: 25, room: "W1N1" },
      { x: 5, y: 40, room: "W1N1" },
      { x: 0, y: 0, room: "W1N1" }
    ]) {
      const tiles = slotTiles(anchor, BLOCK_2X2);
      expect(isMutualRangeOne(tiles)).toBe(true);
    }
  });

  it("returns the IDENTICAL tile set for two different formations that only differ in slot ORDER (no rotation to disagree about)", () => {
    const anchor = { x: 25, y: 25, room: "W1N1" };
    const key = (tiles: { x: number; y: number }[]) =>
      tiles
        .map(t => `${t.x},${t.y}`)
        .sort()
        .join("|");
    const reordered: Formation = [BLOCK_2X2[0], BLOCK_2X2[2], BLOCK_2X2[1], BLOCK_2X2[3]];
    expect(key(slotTiles(anchor, BLOCK_2X2))).toBe(key(slotTiles(anchor, reordered)));
  });

  it("carries each slot's role onto its tile so callers can match a creep's role to a slot", () => {
    const tiles = slotTiles({ x: 10, y: 10, room: "W2N2" }, BLOCK_2X2);
    expect(tiles.map(t => t.role).sort()).toEqual(["anchor", "b", "c", "d"]);
  });

  it("resolves a slot that crosses a room border into the NEIGHBORING room's local coords, never x/y outside 0..49", () => {
    // Anchor sits at x=49 (the room's east edge); the "b"/"d" slots' +1 x-offset pushes past it. Plain
    // anchor.x+dx arithmetic (local-only) would produce x=50 — an invalid RoomPosition (constructor throws
    // on out-of-range x/y) that crashed the whole tick's creep loop when a live squad's anchor sat at a
    // border (confirmed live: RoomPosition(50, 9, "W6N3") threw inside runSquadMember). The world-coordinate
    // lattice (geometry.ts's worldOf/roomAndLocal) must instead land those slots in the room one hop EAST.
    const tiles = slotTiles({ x: 49, y: 25, room: "W5N5" }, BLOCK_2X2);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(49);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(49);
    }
    // The anchor and the "c" slot (dy-only offset) stay in the anchor's own room; "b" and "d" (dx:+1) cross
    // into the room immediately east.
    const byRole = Object.fromEntries(tiles.map(t => [t.role, t]));
    expect(byRole.anchor.room).toBe("W5N5");
    expect(byRole.c.room).toBe("W5N5");
    expect(byRole.b.room).not.toBe("W5N5");
    expect(byRole.d.room).not.toBe("W5N5");
    expect(byRole.b.x).toBe(0); // wrapped to the neighboring room's west edge, not x=50
    expect(byRole.b.room).toBe(byRole.d.room); // both crossing slots land in the SAME neighboring room
  });
});

describe("parseRectFormation", () => {
  it("builds a 2x2 block filled with the given role", () => {
    const formation = parseRectFormation("2x2", "paradeMember");
    expect(formation).toHaveLength(4);
    expect(formation?.every(s => s.role === "paradeMember")).toBe(true);
    expect(new Set(formation?.map(s => `${s.dx},${s.dy}`))).toEqual(new Set(["0,0", "1,0", "0,1", "1,1"]));
  });

  it("builds a 3x3 square, not just 2x2", () => {
    const formation = parseRectFormation("3x3", "paradeMember");
    expect(formation).toHaveLength(9);
    expect(formation?.[0]).toEqual({ dx: 0, dy: 0, role: "paradeMember" });
  });

  it("returns undefined for a malformed shape string", () => {
    expect(parseRectFormation("bogus", "paradeMember")).toBeUndefined();
    expect(parseRectFormation("2x", "paradeMember")).toBeUndefined();
    expect(parseRectFormation("x2", "paradeMember")).toBeUndefined();
  });

  it("returns undefined for a non-positive dimension", () => {
    expect(parseRectFormation("0x2", "paradeMember")).toBeUndefined();
  });

  // Squad pathing (squadPath.ts/squadCostMatrix.ts) requires every formation's bounding box to be square
  // with the anchor at its own top-left corner (assertSquareTopLeftAnchor below) — a non-square shape like
  // "1x3" is rejected here, at the player-facing boundary (a flag name typo), rather than reaching that
  // assertion with an invalid formation. The caller (paradeFlags.ts) falls back to a default shape.
  it("returns undefined for a non-square shape", () => {
    expect(parseRectFormation("1x3", "paradeMember")).toBeUndefined();
    expect(parseRectFormation("2x3", "paradeMember")).toBeUndefined();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRectFormation(" 2x2 ", "paradeMember")).toHaveLength(4);
  });
});

describe("assertSquareTopLeftAnchor", () => {
  it("accepts a square formation anchored at (0,0)", () => {
    expect(() => assertSquareTopLeftAnchor(BLOCK_2X2)).not.toThrow();
  });

  it("rejects a non-square bounding box", () => {
    expect(() => assertSquareTopLeftAnchor(BLOCK_2X3)).toThrow(/square/);
  });

  // The exact shape squadCostMatrix.ts's "trailing" test used before the square/top-left-anchor constraint
  // was introduced — a slot at dx:-1 behind the anchor. Still valid FORMATION-SHAPE geometry (footprintSize
  // still computes anchorDx/anchorDy correctly for it), but no longer a shape any real squad formation may
  // use, since pathing now assumes every formation satisfies this constraint.
  it("rejects a slot trailing BEHIND the anchor (dx < 0)", () => {
    const trailing: Formation = [
      { dx: 0, dy: 0, role: "anchor" },
      { dx: -1, dy: 0, role: "b" }
    ];
    expect(() => assertSquareTopLeftAnchor(trailing)).toThrow(/square|behind/);
  });

  it("rejects a formation whose slot 0 isn't the anchor", () => {
    const offCorner: Formation = [
      { dx: 1, dy: 0, role: "a" },
      { dx: 0, dy: 0, role: "anchor" },
      { dx: 1, dy: 1, role: "c" },
      { dx: 0, dy: 1, role: "d" }
    ];
    expect(() => assertSquareTopLeftAnchor(offCorner)).toThrow(/slot 0/);
  });
});
