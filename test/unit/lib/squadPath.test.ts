// findSquadPath/nearestFittingAnchor: footprint-fit routing over a cached, moving-maximum-transformed
// CostMatrix (squadCostMatrix.ts), via real PathFinder.search. Facing is no longer searched here (see
// squadPath.ts's module header) — every step of a route carries the SAME facing it started with, and
// nearestFittingAnchor answers only "where," never "which way."
//
// This file stays at the unit level (stubPathFinderSingleRoom — a real single-room Dijkstra over
// whatever CostMatrix findSquadPath's roomCallback builds, see test/constants.ts) because every case here
// is single-room: the SAME cost matrix squadCostMatrix.test.ts already covers is what's being routed
// over, not room-transition arithmetic. Genuine cross-room routing (PathFinder's own border-stitching) is
// NOT re-implemented here — see test/integration/squad-border-crossing.test.ts for that, run against the
// real engine per the plan's hard constraint (no hand-rolled cross-room position math anywhere, including
// test infrastructure).

import { beforeEach, describe, expect, it } from "vitest";
import { findSquadPath, nearestFittingAnchor, NO_OCCUPANCY, type OccupancySource, type TerrainSource } from "../../../src/lib/squadPath";
import { clearSquadMatrixCache } from "../../../src/lib/squadCostMatrix";
import type { Formation } from "../../../src/lib/formation";
import { clearTiles, stubPathFinderSingleRoom } from "../../constants";

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

beforeEach(() => {
  clearTiles();
  clearSquadMatrixCache();
  stubPathFinderSingleRoom();
});

describe("findSquadPath", () => {
  it("finds a straight path across open terrain where the footprint fits at every step", () => {
    const path = findSquadPath(
      { anchor: { x: 10, y: 10, room: "W1N1" }, facing: TOP },
      { x: 20, y: 10, room: "W1N1" },
      BLOCK_2X2,
      terrainSource({ W1N1: openTerrain() }),
      NO_OCCUPANCY,
      0
    );
    expect(path).toBeDefined();
    const last = path![path!.length - 1];
    expect(last.anchor.room).toBe("W1N1");
    expect(Math.max(Math.abs(last.anchor.x - 20), Math.abs(last.anchor.y - 10))).toBeLessThanOrEqual(1);
    // Facing never changes mid-route — every step carries the SAME facing the route started with.
    for (const step of path!) expect(step.facing).toBe(TOP);
  });

  it("keeps the whole 2x2 footprint on walkable tiles at every step, never routing a slot through a wall", () => {
    // A wall line the anchor could slip past alone but the trailing 2x2 corner cannot — the path must
    // detour so the full footprint always fits, never place a slot on (15,11)/(16,11).
    const terrain = terrainWithWalls([
      [15, 11],
      [16, 11]
    ]);
    const path = findSquadPath(
      { anchor: { x: 10, y: 10, room: "W1N1" }, facing: TOP },
      { x: 20, y: 10, room: "W1N1" },
      BLOCK_2X2,
      terrainSource({ W1N1: terrain }),
      NO_OCCUPANCY,
      0
    );
    expect(path).toBeDefined();
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

  it("reports unreachable (undefined) when the corridor is too narrow for the footprint", () => {
    // A 1-tile-wide corridor: the 2x2 never fits (it always needs a 2x2 block of walkable tiles). Must
    // return undefined — not a partial or degraded route that walks into the dead end.
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
      terrainSource({ W1N1: terrain }),
      NO_OCCUPANCY,
      0
    );
    expect(path).toBeUndefined();
  });

  it("returns a trivial single-step path when the start already sits at the goal", () => {
    const path = findSquadPath(
      { anchor: { x: 25, y: 25, room: "W1N1" }, facing: TOP },
      { x: 25, y: 25, room: "W1N1" },
      BLOCK_2X2,
      terrainSource({ W1N1: openTerrain() }),
      NO_OCCUPANCY,
      0
    );
    expect(path).toBeDefined();
    expect(path![0].anchor).toEqual({ x: 25, y: 25, room: "W1N1" });
  });

  it("routes around a live bystander occupying the direct path, via OccupancySource", () => {
    const occupancy: OccupancySource = room => {
      if (room !== "W1N1") return undefined;
      const grid = new Uint8Array(2500);
      // A wall of bystanders spanning the footprint's width directly ahead — same shape as the wall test
      // above, but via occupancy rather than terrain, confirming both sources feed the same fit-check.
      grid[15 * 50 + 10] = 1;
      grid[16 * 50 + 10] = 1;
      grid[15 * 50 + 11] = 1;
      grid[16 * 50 + 11] = 1;
      return grid;
    };
    const path = findSquadPath(
      { anchor: { x: 10, y: 10, room: "W1N1" }, facing: TOP },
      { x: 20, y: 10, room: "W1N1" },
      BLOCK_2X2,
      terrainSource({ W1N1: openTerrain() }),
      occupancy,
      0
    );
    expect(path).toBeDefined();
    for (const step of path!) {
      const { x, y } = step.anchor;
      const onBystander = (x === 15 || x === 16) && (y === 10 || y === 11);
      expect(onBystander, `anchor (${x},${y}) placed the footprint on a bystander tile`).toBe(false);
    }
  });
});

describe("nearestFittingAnchor", () => {
  it("returns the starting anchor immediately when the footprint already fits there", () => {
    const fit = nearestFittingAnchor({ x: 25, y: 25, room: "W1N1" }, BLOCK_2X2, terrainSource({ W1N1: openTerrain() }), NO_OCCUPANCY, 0);
    expect(fit).toEqual({ x: 25, y: 25, room: "W1N1" });
  });

  it("finds the nearest tile where the footprint fits when the starting tile doesn't", () => {
    // A wall square swallowing the starting anchor's own footprint — nearestFittingAnchor must search
    // outward and find open ground nearby, not just fail.
    const walls: [number, number][] = [];
    for (let x = 20; x <= 30; x++) for (let y = 20; y <= 30; y++) walls.push([x, y]);
    const terrain = terrainWithWalls(walls);
    const fit = nearestFittingAnchor({ x: 25, y: 25, room: "W1N1" }, BLOCK_2X2, terrainSource({ W1N1: terrain }), NO_OCCUPANCY, 0);
    expect(fit).toBeDefined();
    // The returned anchor's own 2x2 footprint must actually be clear.
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ]) {
      expect(terrain[(fit!.x + dx) * 50 + (fit!.y + dy)]).not.toBe(0);
    }
  });

  it("returns undefined when nothing fits within the search radius", () => {
    // A 1-tile-wide corridor everywhere in W1N1, with every neighboring room explicitly walled solid too
    // (an undefined TerrainSource entry is fail-open, not impassable — see TerrainSource's own doc — so a
    // real "nothing fits anywhere nearby" case must wall the rooms the search radius can actually reach,
    // not rely on unlisted rooms reading as blocked). Centered away from any border so the 15-tile search
    // radius never needs to consult a room this test hasn't defined at all.
    const walls: [number, number][] = [];
    for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) if (y !== 10) walls.push([x, y]);
    const corridor = terrainWithWalls(walls);
    const solidWall = new Uint8Array(2500); // all zero = solid wall everywhere
    const terrain: TerrainSource = room => (room === "W1N1" ? corridor : solidWall);
    const fit = nearestFittingAnchor({ x: 25, y: 10, room: "W1N1" }, BLOCK_2X2, terrain, NO_OCCUPANCY, 0);
    expect(fit).toBeUndefined();
  });
});
