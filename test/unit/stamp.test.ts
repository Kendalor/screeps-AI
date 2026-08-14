import { describe, expect, it } from "vitest";
import { distanceTransform, findAnchorCandidates, pickAnchor, stampLayout } from "../../src/layouts/stamp";
import type { GoalPlacement } from "../../src/layouts/sync";

function openRoom(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}

describe("distanceTransform", () => {
  it("returns high clearance in the center of a fully open room, tapering to the edge", () => {
    const dt = distanceTransform(openRoom());
    const at = (x: number, y: number) => dt[x * 50 + y];

    expect(at(0, 25)).toBe(0);
    expect(at(25, 0)).toBe(0);
    const column = [0, 1, 2, 3, 4, 5].map(y => at(25, y));
    for (let i = 1; i < column.length; i++) {
      expect(column[i]).toBeGreaterThan(column[i - 1]);
    }
    expect(at(25, 25)).toBeGreaterThan(at(25, 5));
  });

  it("reduces clearance near a wall block", () => {
    const withoutWall = distanceTransform(openRoom());

    const withWall = openRoom();
    for (let x = 20; x < 30; x++) {
      withWall[x * 50 + 25] = 0;
    }
    const dt = distanceTransform(withWall);
    const at = (x: number, y: number) => dt[x * 50 + y];

    expect(at(25, 24)).toBeLessThan(withoutWall[25 * 50 + 24]);
    expect(at(25, 24)).toBeLessThanOrEqual(1);
  });
});

describe("findAnchorCandidates", () => {
  it("returns tiles within a small open pocket that has enough radius to fit the bunker", () => {
    const terrain = new Uint8Array(2500); // all wall
    for (let x = 10; x <= 20; x++) {
      for (let y = 10; y <= 20; y++) {
        terrain[x * 50 + y] = 1;
      }
    }

    const candidates = findAnchorCandidates(terrain, 2);

    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.x).toBeGreaterThanOrEqual(11);
      expect(c.x).toBeLessThanOrEqual(19);
      expect(c.y).toBeGreaterThanOrEqual(11);
      expect(c.y).toBeLessThanOrEqual(19);
    }
    expect(candidates).toContainEqual({ x: 15, y: 15 });
    expect(candidates).not.toContainEqual({ x: 10, y: 15 });
  });

  it("returns no candidates for a room that is entirely wall", () => {
    const terrain = new Uint8Array(2500); // all zero = all wall

    expect(findAnchorCandidates(terrain, 2)).toEqual([]);
  });

  it("includes a tile whose clearance exactly equals bunkerRadius (regression: legacy threshold inconsistency)", () => {
    const terrain = openRoom();
    const dt = distanceTransform(openRoom());
    expect(dt[6 * 50 + 25]).toBe(6);

    expect(findAnchorCandidates(terrain, 6)).toContainEqual({ x: 6, y: 25 });
  });

  it("treats the room border as impassable regardless of exit-gap terrain values", () => {
    // distanceTransform forces oob at every border cell's lookup unconditionally (n % 50 === 0/49,
    // row 0/49), so whether a border tile is a solid wall or an open exit doesn't matter — the
    // border always caps clearance the same way. Confirmed by diffing full output for a room
    // with a 2-tile exit gap left walkable vs. one with the border fully walled: identical.
    const withExitGapOpen = openRoom();
    for (let y = 0; y < 50; y++) {
      if (y === 24 || y === 25) continue; // exit gap: real terrain.get() reports this as non-wall
      withExitGapOpen[0 * 50 + y] = 0;
    }
    const withExitGapClosed = withExitGapOpen.slice();
    withExitGapClosed[0 * 50 + 24] = 0;
    withExitGapClosed[0 * 50 + 25] = 0;

    const dtOpen = distanceTransform(withExitGapOpen.slice());
    const dtClosed = distanceTransform(withExitGapClosed.slice());
    expect(Array.from(dtOpen)).toEqual(Array.from(dtClosed));
  });
});

describe("pickAnchor", () => {
  it("prefers a candidate near the controller+sources over raw room-center", () => {
    const room = {
      controller: { x: 5, y: 5 },
      sources: [{ x: 6, y: 5 }, { x: 5, y: 6 }]
    };
    const candidates = [
      { x: 24, y: 24 }, // far from controller/sources
      { x: 6, y: 6 } // close to controller and both sources
    ];

    expect(pickAnchor(candidates, room)).toEqual({ x: 6, y: 6 });
  });

  it("weights the controller more heavily than the sources", () => {
    const room = { controller: { x: 0, y: 0 }, sources: [{ x: 30, y: 0 }] };
    const near = { x: 5, y: 0 }; // controller range 5, source range 25
    const far = { x: 12, y: 0 }; // controller range 12, source range 18

    // Equal weighting ties both at 30 (5+25 vs 12+18); weighting the controller
    // 2x favors `near`: (2*5 + 25 = 35) < (2*12 + 18 = 42).
    expect(pickAnchor([far, near], room)).toEqual(near);
  });
});

describe("stampLayout", () => {
  it("translates anchor-relative placements onto an absolute anchor position", () => {
    const placements: GoalPlacement[] = [
      { x: 0, y: 0, type: "spawn", order: 0 },
      { x: -1, y: -1, type: "road", order: 1 },
      { x: 1, y: 1, type: "road", order: 2 }
    ];

    expect(stampLayout(placements, { x: 25, y: 25 })).toEqual([
      { x: 25, y: 25, type: "spawn" },
      { x: 24, y: 24, type: "road" },
      { x: 26, y: 26, type: "road" }
    ]);
  });
});
