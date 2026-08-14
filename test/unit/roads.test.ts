import { describe, expect, it } from "vitest";
import { buildCostMatrix, controllerRoadPath, sourceRoadPath } from "../../src/layouts/roads";
import type { XY } from "../../src/lib/geometry";

function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1); // all walkable
}

// A path is connected if consecutive tiles are adjacent (Chebyshev range 1).
function isConnected(path: XY[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const dx = Math.abs(path[i].x - path[i - 1].x);
    const dy = Math.abs(path[i].y - path[i - 1].y);
    if (Math.max(dx, dy) !== 1) return false;
  }
  return true;
}

describe("buildCostMatrix", () => {
  it("marks wall tiles impassable", () => {
    const terrain = openTerrain();
    terrain[10 * 50 + 10] = 0; // wall

    const cm = buildCostMatrix({ terrain, structures: [] });

    expect(cm.get(10, 10)).toBe(255);
  });

  it("marks existing road tiles cheap", () => {
    const terrain = openTerrain();

    const cm = buildCostMatrix({ terrain, structures: [{ x: 12, y: 12, type: "road" }] });

    expect(cm.get(12, 12)).toBe(1);
  });

  it("prices a road strictly below plain terrain, so a tie always keeps the built route", () => {
    const cm = buildCostMatrix({ terrain: openTerrain(), structures: [{ x: 12, y: 12, type: "road" }] });

    expect(cm.get(12, 12)).toBeLessThan(cm.get(13, 13)); // (13,13) is plain terrain, unclaimed
  });

  it("leaves container tiles walkable — creeps stand on them, they are not obstacles", () => {
    const cm = buildCostMatrix({
      terrain: openTerrain(),
      structures: [{ x: 12, y: 12, type: "container" }]
    });

    expect(cm.get(12, 12)).toBeLessThan(255);
  });

  it("marks blocking structures impassable", () => {
    const cm = buildCostMatrix({
      terrain: openTerrain(),
      structures: [{ x: 12, y: 12, type: "extension" }]
    });

    expect(cm.get(12, 12)).toBe(255);
  });

  // A road can never legitimately stand on a wall — Screeps refuses the construction site outright — so
  // a "road" structure entry at a wall tile is always bogus input, not a real claim to trust. Confirmed
  // live on W47N14 2026-08-13: a remote-room road claim leaked into the home room's structures list
  // (same (x,y), different room — see operations/mining.ts and operations/upgrading.ts's now-fixed
  // room filter) and, before this guard existed, turned a real wall into a cheap ROAD_COST tile, letting
  // A* "tunnel" straight through it.
  it("never lets a road claim override wall terrain — wall wins even over a claimed road", () => {
    const terrain = openTerrain();
    terrain[12 * 50 + 12] = 0; // wall

    const cm = buildCostMatrix({ terrain, structures: [{ x: 12, y: 12, type: "road" }] });

    expect(cm.get(12, 12)).toBe(255);
  });
});

describe("sourceRoadPath", () => {
  it("returns a connected path from anchor to a tile adjacent to the source", () => {
    const cm = buildCostMatrix({ terrain: openTerrain(), structures: [] });
    const anchor: XY = { x: 10, y: 10 };
    const source: XY = { x: 20, y: 10 };

    const { path } = sourceRoadPath(anchor, source, cm);

    expect(path[0]).toEqual(anchor);
    expect(isConnected(path)).toBe(true);
    const last = path[path.length - 1];
    expect(Math.max(Math.abs(last.x - source.x), Math.abs(last.y - source.y))).toBe(1);
  });

  it("places the container/link spot adjacent to the source, not on top of it", () => {
    const cm = buildCostMatrix({ terrain: openTerrain(), structures: [] });
    const anchor: XY = { x: 10, y: 10 };
    const source: XY = { x: 20, y: 10 };

    const { structurePos } = sourceRoadPath(anchor, source, cm);

    expect(structurePos).not.toEqual(source);
    const dist = Math.max(Math.abs(structurePos.x - source.x), Math.abs(structurePos.y - source.y));
    expect(dist).toBe(1);
  });
});

describe("controllerRoadPath", () => {
  it("returns a connected path from anchor to a tile within upgrade range of the controller", () => {
    const cm = buildCostMatrix({ terrain: openTerrain(), structures: [] });
    const anchor: XY = { x: 10, y: 10 };
    const controller: XY = { x: 10, y: 25 };

    const { path } = controllerRoadPath(anchor, controller, cm);

    expect(path[0]).toEqual(anchor);
    expect(isConnected(path)).toBe(true);
    const last = path[path.length - 1];
    const dist = Math.max(Math.abs(last.x - controller.x), Math.abs(last.y - controller.y));
    expect(dist).toBeLessThanOrEqual(3);
  });
});

describe("road reuse", () => {
  it("prefers a built road over an equally-short unpaved detour", () => {
    const terrain = openTerrain();
    // A single-tile wall wedge at (15,10) forces a one-tile detour either above or below it —
    // both are equally short. Roads/roomplanner regression: without a cost edge favoring the
    // paved side, an A* tie could route onto the bare tile instead, stranding the built road.
    terrain[15 * 50 + 10] = 0;

    const cm = buildCostMatrix({ terrain, structures: [{ x: 15, y: 9, type: "road" }] }); // paved above the wedge
    const anchor: XY = { x: 10, y: 10 };
    const source: XY = { x: 20, y: 10 };

    const { path } = sourceRoadPath(anchor, source, cm);

    expect(path.some(p => p.x === 15 && p.y === 9)).toBe(true); // took the paved detour
    expect(path.some(p => p.x === 15 && p.y === 11)).toBe(false); // not the unpaved one
  });
});

describe("obstacle routing", () => {
  it("routes around a wall obstacle rather than through it", () => {
    const terrain = openTerrain();
    // A wall wedge blocking the direct line between anchor and source.
    for (let y = 5; y <= 15; y++) {
      terrain[15 * 50 + y] = 0;
    }
    const cm = buildCostMatrix({ terrain, structures: [] });
    const anchor: XY = { x: 10, y: 10 };
    const source: XY = { x: 20, y: 10 };

    const { path } = sourceRoadPath(anchor, source, cm);

    expect(isConnected(path)).toBe(true);
    for (const p of path) {
      expect(cm.get(p.x, p.y)).toBeLessThan(255);
    }
    // Must detour around the wall band (y 5..15 at x=15), not cross it.
    expect(path.some(p => p.x === 15 && (p.y < 5 || p.y > 15))).toBe(true);
  });
});
