// findSquadPath: footprint-fit A* over an augmented (x, y, room, facing) state space. An edge either
// advances the anchor one tile (facing tracks the direction moved) or holds the anchor and reforms to a
// new facing in place (a stationary reform, priced as a flat estimate). A candidate anchor+facing is only
// valid if EVERY slot of the whole formation fits on walkable terrain there (regardless of occupancy).
// Plain XY/terrain in, path steps out — no Game, mirroring the old formation.test.ts directness.

import { describe, expect, it } from "vitest";
import { findSquadPath, type TerrainSource } from "../../../src/lib/squadPath";
import type { Formation } from "../../../src/lib/formation";

// A 2x2 block trailing right/down of the anchor at the canonical TOP facing (Drain's shape).
const BLOCK_2X2: Formation = [
  { dx: 0, dy: 0, role: "a" },
  { dx: 1, dy: 0, role: "b" },
  { dx: 0, dy: 1, role: "c" },
  { dx: 1, dy: 1, role: "d" }
];

function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}

// All-walkable except the given wall tiles (1=walkable, 0=wall, [x*50+y]-indexed, matching the engine).
function terrainWithWalls(walls: [number, number][]): Uint8Array {
  const t = openTerrain();
  for (const [x, y] of walls) t[x * 50 + y] = 0;
  return t;
}

function terrainSource(map: Record<string, Uint8Array>): TerrainSource {
  return room => map[room];
}

describe("findSquadPath", () => {
  it("finds a straight path across open terrain where the footprint fits at every step (no reform)", () => {
    const path = findSquadPath(
      { anchor: { x: 10, y: 10, room: "W1N1" }, facing: TOP },
      { x: 20, y: 10, room: "W1N1" },
      BLOCK_2X2,
      terrainSource({ W1N1: openTerrain() })
    );
    expect(path).toBeDefined();
    // Ends with the anchor on (or adjacent to a full footprint fitting at) the goal.
    const last = path![path!.length - 1];
    expect(last.anchor.room).toBe("W1N1");
    expect(Math.max(Math.abs(last.anchor.x - 20), Math.abs(last.anchor.y - 10))).toBeLessThanOrEqual(1);
    // Every step's facing is one of the 8 compass directions (a real DirectionConstant).
    for (const step of path!) expect(step.facing).toBeGreaterThanOrEqual(1);
  });

  it("keeps the whole 2x2 footprint on walkable tiles at every step, never routing a slot through a wall", () => {
    // A wall line the anchor could slip past alone but the trailing 2x2 corner cannot — the path must
    // detour so the full footprint always fits, never place a slot on (15,11).
    const terrain = terrainWithWalls([
      [15, 11],
      [16, 11]
    ]);
    const path = findSquadPath(
      { anchor: { x: 10, y: 10, room: "W1N1" }, facing: TOP },
      { x: 20, y: 10, room: "W1N1" },
      BLOCK_2X2,
      terrainSource({ W1N1: terrain })
    );
    expect(path).toBeDefined();
    // No step ever puts any slot of the footprint on a walled tile.
    for (const step of path!) {
      const { x, y } = step.anchor;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1]
      ]) {
        expect(terrain[(x + dx) * 50 + (y + dy)]).not.toBe(0);
      }
    }
  });

  it("forces a hold-and-reform (a same-tile facing change) when the footprint only fits after reorienting", () => {
    // A 1x3 LINE formation (anchor + two tiles trailing at the canonical facing) is asymmetric: it needs
    // a 3-long horizontal strip when facing sideways and a 3-long vertical strip when facing up/down. In
    // an L-shaped 1-tile-wide corridor (horizontal run into a vertical run), the line fits horizontally
    // in the first leg and vertically in the second, so passing the bend REQUIRES a reform (anchor held,
    // facing changed) — a straight advance can't reorient. We assert a consecutive pair of steps shares
    // an anchor tile but differs in facing, the signature of an in-place reform.
    const LINE_1X3: Formation = [
      { dx: 0, dy: 0, role: "a" },
      { dx: 1, dy: 0, role: "b" },
      { dx: 2, dy: 0, role: "c" }
    ];
    // Layout: a 1-wide horizontal corridor (only admits the line horizontal) opening into a 3x3 pocket
    // (roomy enough to reform the line in place), then a 1-wide vertical corridor (only admits it
    // vertical). Reaching the vertical leg from the horizontal one is impossible without reorienting in
    // the pocket.
    const walkable = (x: number, y: number): boolean => {
      const inHoriz = y === 15 && x >= 5 && x <= 20; // horizontal 1-wide corridor
      const inPocket = x >= 20 && x <= 22 && y >= 14 && y <= 16; // 3x3 reform pocket
      const inVert = x === 22 && y >= 16 && y <= 30; // vertical 1-wide corridor
      return inHoriz || inPocket || inVert;
    };
    const walls: [number, number][] = [];
    for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) if (!walkable(x, y)) walls.push([x, y]);
    const terrain = terrainWithWalls(walls);
    const path = findSquadPath(
      { anchor: { x: 5, y: 15, room: "W1N1" }, facing: TOP }, // horizontal line along the horizontal leg
      { x: 22, y: 28, room: "W1N1" },
      LINE_1X3,
      terrainSource({ W1N1: terrain })
    );
    expect(path).toBeDefined();
    let sawReform = false;
    for (let i = 1; i < path!.length; i++) {
      const prev = path![i - 1];
      const cur = path![i];
      if (prev.anchor.x === cur.anchor.x && prev.anchor.y === cur.anchor.y && prev.facing !== cur.facing) {
        sawReform = true;
      }
    }
    expect(sawReform).toBe(true);
  });

  it("reports unreachable (undefined) when the corridor is too narrow for the footprint in ANY orientation", () => {
    // A 1-tile-wide corridor: no orientation of a 2x2 ever fits (it always needs a 2x2 block of walkable
    // tiles). Must return undefined — not a partial or degraded route that walks into the dead end.
    const walls: [number, number][] = [];
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (y !== 10) walls.push([x, y]); // only row y=10 is walkable — a 1-wide corridor
      }
    }
    const terrain = terrainWithWalls(walls);
    const path = findSquadPath(
      { anchor: { x: 10, y: 10, room: "W1N1" }, facing: TOP },
      { x: 20, y: 10, room: "W1N1" },
      BLOCK_2X2,
      terrainSource({ W1N1: terrain })
    );
    expect(path).toBeUndefined();
  });

  it("paths across a room border, carrying terrain for both rooms (no special case)", () => {
    // Anchor near the east border of W1N1, goal just inside W2N1. Both rooms open — the footprint fits
    // across the seam, and the path must include a step whose anchor lands in W2N1.
    const path = findSquadPath(
      { anchor: { x: 46, y: 25, room: "W1N1" }, facing: TOP },
      { x: 3, y: 25, room: "W2N1" },
      BLOCK_2X2,
      terrainSource({ W1N1: openTerrain(), W2N1: openTerrain() })
    );
    expect(path).toBeDefined();
    expect(path!.some(s => s.anchor.room === "W2N1")).toBe(true);
    const last = path![path!.length - 1];
    expect(last.anchor.room).toBe("W2N1");
  });

  it("returns a trivial single-step path when the start already sits at the goal", () => {
    const path = findSquadPath(
      { anchor: { x: 25, y: 25, room: "W1N1" }, facing: TOP },
      { x: 25, y: 25, room: "W1N1" },
      BLOCK_2X2,
      terrainSource({ W1N1: openTerrain() })
    );
    expect(path).toBeDefined();
    expect(path![0].anchor).toEqual({ x: 25, y: 25, room: "W1N1" });
  });
});
