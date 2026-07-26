// Regression test for the cross-room path-serialization bug: a scout stuck oscillating at a room
// border (reported live on the pserver between W10N4/W10N5) traced back to serializePath silently
// dropping the one step that crosses a room boundary, corrupting every direction that followed it.

import { beforeEach, describe, expect, it } from "vitest";

// The module patches Creep.prototype.travelTo as an import-time side effect; stub it before import.
(globalThis as Record<string, unknown>).Creep = function Creep() {} as unknown as typeof Creep;
(globalThis as { Creep: { prototype: object } }).Creep.prototype = {};

const { Traveler } = await import("../../src/lib/traveler");

// Minimal RoomPosition stand-in: only roomName + getDirectionTo, the only members serializePath touches.
function pos(roomName: string, x: number, y: number): RoomPosition {
  return {
    roomName,
    x,
    y,
    getDirectionTo(target: { roomName: string; x: number; y: number }) {
      const dx = Math.sign(target.x - this.x);
      const dy = Math.sign(target.y - this.y);
      // Screeps DirectionConstant layout: 1 TOP .. 8 TOP_LEFT, clockwise from north.
      const table: Record<string, number> = {
        "0,-1": 1, "1,-1": 2, "1,0": 3, "1,1": 4,
        "0,1": 5, "-1,1": 6, "-1,0": 7, "-1,-1": 8
      };
      return table[`${dx},${dy}`] ?? 0;
    }
  } as unknown as RoomPosition;
}

beforeEach(() => {
  // serializePath draws debug lines/circles; stub them as no-ops for the test environment.
  (globalThis as Record<string, unknown>).RoomVisual = class {
    line() { return this; }
    circle() { return this; }
  };
});

describe("Traveler.serializePath", () => {
  it("emits one direction per step within a single room", () => {
    const start = pos("W10N5", 47, 25);
    const path = [pos("W10N5", 48, 25), pos("W10N5", 49, 25)];
    expect(Traveler.serializePath(start, path)).toHaveLength(2);
  });

  it("still emits a direction for the step that crosses into the next room", () => {
    // Border crossing: last tile of W10N5 (x=49) to the first tile of W10N4 (x=0), same y.
    const start = pos("W10N5", 48, 25);
    const path = [pos("W10N5", 49, 25), pos("W10N4", 0, 25)];
    const serialized = Traveler.serializePath(start, path);
    // One direction per path entry — the border-crossing step must not be silently dropped, or every
    // subsequent direction is walked from the wrong (pre-crossing) position and the creep never commits.
    expect(serialized).toHaveLength(path.length);
  });
});
