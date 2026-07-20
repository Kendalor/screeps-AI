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

    // Room edges are treated as walls, so clearance is 0 right at the border...
    expect(at(0, 25)).toBe(0);
    expect(at(25, 0)).toBe(0);
    // ...and rises monotonically moving inward toward the center.
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
      withWall[x * 50 + 25] = 0; // a horizontal wall band through the room center
    }
    const dt = distanceTransform(withWall);
    const at = (x: number, y: number) => dt[x * 50 + y];

    // A tile just above the wall band has much less clearance than the same
    // tile did in the open room, since the wall is now its nearest obstacle.
    expect(at(25, 24)).toBeLessThan(withoutWall[25 * 50 + 24]);
    expect(at(25, 24)).toBeLessThanOrEqual(1);
  });
});

describe("findAnchorCandidates", () => {
  it("returns tiles within a small open pocket that has enough radius to fit the bunker", () => {
    // A tiny walkable room (bunkerRadius=2) surrounded by wall, big enough to
    // fit a 5x5 bunker footprint (radius 2) roughly in the middle.
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
    // The exact center of the open pocket should have enough clearance to qualify.
    expect(candidates).toContainEqual({ x: 15, y: 15 });
    // A tile right at the pocket's border has no clearance margin and must not qualify.
    expect(candidates).not.toContainEqual({ x: 10, y: 15 });
  });

  it("returns no candidates for a room that is entirely wall", () => {
    const terrain = new Uint8Array(2500); // all zero = all wall

    expect(findAnchorCandidates(terrain, 2)).toEqual([]);
  });

  it("includes a tile whose clearance exactly equals bunkerRadius (regression: legacy threshold inconsistency)", () => {
    // Legacy Bunker.doTransform used `dt >= 6` while RoomPlannerUtils.doTransform
    // used `dt > BUNKER_RADIUS` (6) — the off-by-one excluded exact-fit tiles.
    // This fully open room has a known clearance of exactly 6 at its center.
    const terrain = openRoom();
    const dt = distanceTransform(openRoom());
    expect(dt[6 * 50 + 25]).toBe(6); // sanity-check the fixture's known clearance

    expect(findAnchorCandidates(terrain, 6)).toContainEqual({ x: 6, y: 25 });
  });
});

describe("pickAnchor", () => {
  it("prefers a candidate near the controller+sources over raw room-center", () => {
    const room = {
      controller: { x: 5, y: 5 },
      sources: [{ x: 6, y: 5 }, { x: 5, y: 6 }]
    };
    const candidates = [
      { x: 24, y: 24 }, // raw room-center — far from controller/sources
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
