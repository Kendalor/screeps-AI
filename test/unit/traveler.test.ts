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

// Regression for a second, distinct border bug (reported live: a remote miner sitting exactly on the
// border, showing up in each of the two rooms every other tick): isStuck's exit-tile check compared only
// x/y (Coord), never roomName, so a creep that legitimately crossed from one room's exit tile to the
// mirrored exit tile of the next room — a completely normal, successful step — was misread as "camped on
// an exit tile, going nowhere." After DEFAULT_STUCK_VALUE (2) such ticks the path gets discarded and
// recomputed, which re-crosses and gets flagged stuck again: the creep visibly oscillates across the
// border forever instead of ever committing to the far side.
type PrivateTraveler = { isStuck: (creep: unknown, state: unknown) => boolean };
const isStuck = (Traveler as unknown as PrivateTraveler).isStuck.bind(Traveler);

describe("Traveler.isStuck", () => {
  it("is not stuck when the exit-to-exit move actually crossed into a new room", () => {
    const creep = { pos: pos("W10N4", 0, 25) }; // just arrived, mirrored exit tile of the room just left
    const state = { lastCoord: { x: 49, y: 25, roomName: "W10N5" } }; // stood on W10N5's exit tile last tick
    expect(isStuck(creep, state)).toBe(false);
  });

  it("is stuck when genuinely camped on the same room's exit tile without moving", () => {
    const creep = { pos: pos("W10N5", 49, 25) };
    const state = { lastCoord: { x: 49, y: 25, roomName: "W10N5" } };
    expect(isStuck(creep, state)).toBe(true);
  });

  it("is stuck when the position is unchanged, exit tile or not", () => {
    const creep = { pos: pos("W10N5", 25, 25) };
    const state = { lastCoord: { x: 25, y: 25, roomName: "W10N5" } };
    expect(isStuck(creep, state)).toBe(true);
  });

  it("is not stuck on ordinary movement inside one room", () => {
    const creep = { pos: pos("W10N5", 26, 25) };
    const state = { lastCoord: { x: 25, y: 25, roomName: "W10N5" } };
    expect(isStuck(creep, state)).toBe(false);
  });

  // Deploy-time migration: a creep already mid-travel when this fix ships has a _trav.state array
  // serialized under the old 7-element format (no roomName slot), so deserializeState hands isStuck a
  // lastCoord with roomName undefined. The naive `new RoomPosition(x, y, undefined)` throws inside the
  // engine (roomNameToXY calls .substr on it) and takes down every creep's behavior tick — this must
  // fall back to the old room-blind comparison instead of ever constructing that RoomPosition.
  describe("pre-migration state (no roomName recorded yet)", () => {
    it("does not throw, and falls back to a room-blind coordinate comparison", () => {
      const creep = { pos: pos("W10N5", 49, 25) };
      const state = { lastCoord: { x: 49, y: 25, roomName: undefined } };
      expect(() => isStuck(creep, state)).not.toThrow();
      expect(isStuck(creep, state)).toBe(true); // same x/y, old behavior: exit-pinned looks stuck
    });

    it("self-heals false-positive-free once coordinates actually differ", () => {
      const creep = { pos: pos("W10N5", 26, 25) };
      const state = { lastCoord: { x: 25, y: 25, roomName: undefined } };
      expect(() => isStuck(creep, state)).not.toThrow();
      expect(isStuck(creep, state)).toBe(false);
    });
  });
});
