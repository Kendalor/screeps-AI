import { describe, expect, it } from "vitest";
import { nextRouteStep, remoteRouteFor } from "../../src/behaviors/remoteRoute";
import { stubGame } from "../helpers";

const ROUTE = [
  { room: "W1N1", x: 45, y: 25 },
  { room: "W2N1", x: 3, y: 25 },
  { room: "W2N1", x: 2, y: 25 },
  { room: "W2N1", x: 1, y: 25 },
  { room: "W3N1", x: 48, y: 25 },
  { room: "W3N1", x: 11, y: 10 } // container tile
];

describe("nextRouteStep", () => {
  it("returns undefined when no route is given", () => {
    expect(nextRouteStep({ x: 25, y: 25, roomName: "W2N1" }, undefined, "source")).toBeUndefined();
  });

  it("returns undefined when the route doesn't pass through the creep's current room", () => {
    expect(nextRouteStep({ x: 25, y: 25, roomName: "W9N9" }, ROUTE, "source")).toBeUndefined();
  });

  it("steps toward the source end (increasing index) when already on a route tile", () => {
    expect(nextRouteStep({ x: 2, y: 25, roomName: "W2N1" }, ROUTE, "source")).toEqual({ room: "W2N1", x: 1, y: 25 });
  });

  it("steps toward the home end (decreasing index) when already on a route tile", () => {
    expect(nextRouteStep({ x: 2, y: 25, roomName: "W2N1" }, ROUTE, "home")).toEqual({ room: "W2N1", x: 3, y: 25 });
  });

  it("clamps at the source end instead of running past the container tile", () => {
    expect(nextRouteStep({ x: 11, y: 10, roomName: "W3N1" }, ROUTE, "source")).toEqual({ room: "W3N1", x: 11, y: 10 });
  });

  it("clamps at the home end instead of running past route[0]", () => {
    expect(nextRouteStep({ x: 45, y: 25, roomName: "W1N1" }, ROUTE, "home")).toEqual({ room: "W1N1", x: 45, y: 25 });
  });

  it("merges onto the nearest tile in this room first when off the route, rather than skipping ahead", () => {
    // (40, 40) in W2N1 is nearest to (3,25) among the room's three route tiles — merge there, don't
    // jump straight to the next tile along the corridor.
    expect(nextRouteStep({ x: 40, y: 40, roomName: "W2N1" }, ROUTE, "source")).toEqual({ room: "W2N1", x: 3, y: 25 });
  });
});

describe("remoteRouteFor", () => {
  const remotes = {
    W1N1: {
      remotes: [
        {
          room: "W3N1",
          sources: [{ id: "src1", x: 10, y: 10, distance: 30, route: ROUTE, routeBuilt: "111111" }]
        }
      ]
    }
  };

  it("finds the route for a position in a transit room, not just the source's own room", () => {
    stubGame();
    (Memory as unknown as { colonies: typeof remotes }).colonies = remotes;
    expect(remoteRouteFor("W1N1", { x: 2, y: 25, roomName: "W2N1" })).toBe(ROUTE);
  });

  it("finds the route for a position in the remote source's own room", () => {
    stubGame();
    (Memory as unknown as { colonies: typeof remotes }).colonies = remotes;
    expect(remoteRouteFor("W1N1", { x: 11, y: 10, roomName: "W3N1" })).toBe(ROUTE);
  });

  it("returns undefined for a room no cached route passes through", () => {
    stubGame();
    (Memory as unknown as { colonies: typeof remotes }).colonies = remotes;
    expect(remoteRouteFor("W1N1", { x: 25, y: 25, roomName: "W9N9" })).toBeUndefined();
  });

  it("returns undefined when the colony has no remotes selected yet", () => {
    stubGame();
    (Memory as unknown as { colonies: Record<string, unknown> }).colonies = { W1N1: { remotes: [] } };
    expect(remoteRouteFor("W1N1", { x: 2, y: 25, roomName: "W2N1" })).toBeUndefined();
  });

  it("picks whichever of two sources' routes has a tile nearest the position, when both touch this room", () => {
    stubGame();
    const otherRoute = [
      { room: "W2N1", x: 25, y: 3 },
      { room: "W2N1", x: 25, y: 2 }
    ];
    (Memory as unknown as { colonies: typeof remotes }).colonies = {
      W1N1: {
        remotes: [
          { room: "W3N1", sources: [{ id: "src1", x: 10, y: 10, distance: 30, route: ROUTE, routeBuilt: "111111" }] },
          { room: "W4N1", sources: [{ id: "src2", x: 10, y: 10, distance: 20, route: otherRoute, routeBuilt: "11" }] }
        ]
      }
    };
    // (25,2) is far closer to otherRoute's own tiles than to ROUTE's W2N1 tiles (3/2/1,25).
    expect(remoteRouteFor("W1N1", { x: 25, y: 2, roomName: "W2N1" })).toBe(otherRoute);
  });
});
