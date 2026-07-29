import { describe, it, expect } from "vitest";
import { remoteDistanceEstimate, ROOM_CROSSING_TILES } from "../../../src/mining/distance";

describe("remoteDistanceEstimate", () => {
  it("is roughly one room-crossing for a source in an adjacent room", () => {
    // Home storage and remote source both near their room centers: the estimate is dominated by the
    // single room crossing between the two adjacent rooms.
    const d = remoteDistanceEstimate({
      roomDistance: 1,
      source: { x: 25, y: 25 },
      storage: { x: 25, y: 25 }
    });
    expect(d).toBeCloseTo(ROOM_CROSSING_TILES, 0);
  });

  it("costs more the farther the remote room is", () => {
    const near = remoteDistanceEstimate({ roomDistance: 1, source: { x: 25, y: 25 }, storage: { x: 25, y: 25 } });
    const far = remoteDistanceEstimate({ roomDistance: 2, source: { x: 25, y: 25 }, storage: { x: 25, y: 25 } });
    expect(far).toBeGreaterThan(near);
    // Each extra room is one more crossing.
    expect(far - near).toBeCloseTo(ROOM_CROSSING_TILES, 0);
  });

  it("adds the in-room distance of a source sitting near a room edge", () => {
    const centered = remoteDistanceEstimate({ roomDistance: 1, source: { x: 25, y: 25 }, storage: { x: 25, y: 25 } });
    const edged = remoteDistanceEstimate({ roomDistance: 1, source: { x: 5, y: 25 }, storage: { x: 25, y: 25 } });
    // A source 20 tiles off-center adds ~20 tiles to the haul.
    expect(edged - centered).toBeCloseTo(20, 0);
  });

  it("prices a diagonal room by its real room-graph hops, not Chebyshev distance", () => {
    // A room only connects to its N/S/E/W neighbours, so a diagonally-offset room is at least 2 hops
    // away even though Game.map.getRoomLinearDistance would call it 1. The caller (pickRemotes, fed by
    // scoutGraph.ts's BFS) is responsible for supplying the real hop count here — this just checks the
    // estimate scales with whatever roomDistance it's given.
    const straight = remoteDistanceEstimate({ roomDistance: 1, source: { x: 25, y: 25 }, storage: { x: 25, y: 25 } });
    const diagonal = remoteDistanceEstimate({ roomDistance: 2, source: { x: 25, y: 25 }, storage: { x: 25, y: 25 } });
    expect(diagonal).toBeGreaterThan(straight);
  });
});
