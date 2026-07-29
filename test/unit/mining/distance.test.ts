import { describe, it, expect } from "vitest";
import { remoteDistanceEstimate, ROOM_CROSSING_TILES } from "../../../src/mining/distance";

describe("remoteDistanceEstimate", () => {
  it("is roughly one room-crossing for a source in an adjacent room", () => {
    // Home storage and remote source both near their room centers: the estimate is dominated by the
    // single room crossing between the two adjacent rooms.
    const d = remoteDistanceEstimate({
      home: "W1N1",
      remote: "W2N1",
      source: { x: 25, y: 25 },
      storage: { x: 25, y: 25 }
    });
    expect(d).toBeCloseTo(ROOM_CROSSING_TILES, 0);
  });

  it("costs more the farther the remote room is", () => {
    const near = remoteDistanceEstimate({ home: "W1N1", remote: "W2N1", source: { x: 25, y: 25 }, storage: { x: 25, y: 25 } });
    const far = remoteDistanceEstimate({ home: "W1N1", remote: "W3N1", source: { x: 25, y: 25 }, storage: { x: 25, y: 25 } });
    expect(far).toBeGreaterThan(near);
    // Each extra room is one more crossing.
    expect(far - near).toBeCloseTo(ROOM_CROSSING_TILES, 0);
  });

  it("adds the in-room distance of a source sitting near a room edge", () => {
    const centered = remoteDistanceEstimate({ home: "W1N1", remote: "W2N1", source: { x: 25, y: 25 }, storage: { x: 25, y: 25 } });
    const edged = remoteDistanceEstimate({ home: "W1N1", remote: "W2N1", source: { x: 5, y: 25 }, storage: { x: 25, y: 25 } });
    // A source 20 tiles off-center adds ~20 tiles to the haul.
    expect(edged - centered).toBeCloseTo(20, 0);
  });
});
