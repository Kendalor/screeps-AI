// Pure room-name math — the port of legacy MapRoom's classification. No Game, no map: the
// highway/keeper/intersection rules are a function of the coordinates in the name alone, so they are
// unit-testable directly. Adjacency (Game.map.describeExits) is NOT here — that needs the live map
// and lives at the snapshot boundary.

import { describe, expect, it } from "vitest";
import { parseRoomName, roomType, roomLinearDistance } from "../../src/lib/roomName";

describe("parseRoomName", () => {
  it("splits quadrant letters and coordinates", () => {
    expect(parseRoomName("W7N4")).toEqual({ wx: "W", x: 7, wy: "N", y: 4 });
    expect(parseRoomName("E12S30")).toEqual({ wx: "E", x: 12, wy: "S", y: 30 });
  });
});

describe("roomType", () => {
  // A highway room sits on a multiple-of-10 line in either axis.
  it("classifies highways", () => {
    expect(roomType("W10N4")).toBe("highway");
    expect(roomType("W4N10")).toBe("highway");
  });

  // Both coordinates multiples of 10 → the crossroads room.
  it("classifies intersections", () => {
    expect(roomType("W10N10")).toBe("intersection");
    expect(roomType("W0N0")).toBe("intersection");
  });

  // The 3x3 block of source-keeper rooms sits at coordinates 4-6 (mod 10) in both axes,
  // excluding the center (5,5) which is the keeper *lair* room — legacy treats 4..6 as keeper.
  it("classifies source-keeper rooms", () => {
    expect(roomType("W4N4")).toBe("keeper");
    expect(roomType("W5N6")).toBe("keeper");
    expect(roomType("W6N4")).toBe("keeper");
  });

  // Everything else — the ordinary rooms a colony can own or remote-mine.
  it("classifies normal rooms", () => {
    expect(roomType("W1N1")).toBe("normal");
    expect(roomType("W7N3")).toBe("normal");
    expect(roomType("W8N8")).toBe("normal");
  });
});

describe("roomLinearDistance", () => {
  it("is zero to itself", () => {
    expect(roomLinearDistance("W1N1", "W1N1")).toBe(0);
  });

  // Same quadrant: Chebyshev distance between the coordinates.
  it("is Chebyshev distance within a quadrant", () => {
    expect(roomLinearDistance("W1N1", "W1N4")).toBe(3);
    expect(roomLinearDistance("W1N1", "W4N5")).toBe(4);
  });

  // Crossing the W/E or N/S axis: the coordinates *add* across the seam, because W0 and E0 are
  // adjacent (there is no gap at the origin).
  it("adds coordinates across the W/E seam", () => {
    // W0 and E0 are neighbours, so W0N1 -> E0N1 is distance 1.
    expect(roomLinearDistance("W0N1", "E0N1")).toBe(1);
    // W1N1 -> E1N1: 1 (to seam) + 1 (from seam) + ... = |1 - (-1-1)|? use the +1+1 rule = 3.
    expect(roomLinearDistance("W1N1", "E1N1")).toBe(3);
  });
});
