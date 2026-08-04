import { describe, expect, it } from "vitest";
import { followerOffsets } from "../../../src/lib/formation";
import { range, type XY } from "../../../src/lib/geometry";

/** Every one of the 4 squad members (leader + 3 followers) within Chebyshev range 1 of every other. */
function isMutualRangeOne(positions: readonly XY[]): boolean {
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      if (i === j) continue;
      if (range(positions[i], positions[j]) > 1) return false;
    }
  }
  return true;
}

describe("followerOffsets", () => {
  it("produces a strict 2x2 block (mutual range-1) for a leader moving TOP", () => {
    const leader: XY = { x: 25, y: 25 };
    const followers = followerOffsets(leader, TOP);
    expect(followers).toHaveLength(3);
    expect(isMutualRangeOne([leader, ...followers])).toBe(true);
  });

  it("rotates the block to a different orientation when direction of travel changes", () => {
    const leader: XY = { x: 25, y: 25 };
    const movingTop = followerOffsets(leader, TOP);
    const movingRight = followerOffsets(leader, RIGHT);

    // Still a valid mutual-range-1 block after rotating...
    expect(isMutualRangeOne([leader, ...movingRight])).toBe(true);
    // ...but the actual follower tiles differ from the TOP orientation (it rotated, not stayed fixed).
    expect(movingRight).not.toEqual(movingTop);
  });

  it("is deterministic: identical inputs at a fixed reference direction yield identical outputs", () => {
    const leader: XY = { x: 25, y: 25 };
    const first = followerOffsets(leader, TOP);
    const second = followerOffsets(leader, TOP);
    expect(second).toEqual(first);
  });

  it("produces 4 distinct orientations across the 8 compass directions (a strict 2x2 has no finer rotation)", () => {
    const leader: XY = { x: 25, y: 25 };
    const directions: DirectionConstant[] = [
      TOP,
      TOP_RIGHT,
      RIGHT,
      BOTTOM_RIGHT,
      BOTTOM,
      BOTTOM_LEFT,
      LEFT,
      TOP_LEFT
    ];
    const orientations = new Set(directions.map(d => JSON.stringify(followerOffsets(leader, d))));
    expect(orientations.size).toBe(4);
  });

  it("stays a valid mutual-range-1 block for every direction of travel", () => {
    const leader: XY = { x: 25, y: 25 };
    const directions: DirectionConstant[] = [
      TOP,
      TOP_RIGHT,
      RIGHT,
      BOTTOM_RIGHT,
      BOTTOM,
      BOTTOM_LEFT,
      LEFT,
      TOP_LEFT
    ];
    for (const direction of directions) {
      const followers = followerOffsets(leader, direction);
      expect(isMutualRangeOne([leader, ...followers])).toBe(true);
    }
  });
});
