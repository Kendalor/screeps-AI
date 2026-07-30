import { beforeEach, describe, expect, it } from "vitest";
import { findRemotePath, resolvePathToSource, serializeRemotePath, toRouteTiles } from "../../src/lib/remotePath";
import { clearTiles, stubPathFinder } from "../constants";
import type { ScoutedSource } from "../../src/memory/schema";

describe("findRemotePath", () => {
  beforeEach(clearTiles);

  it("returns the real PathFinder path when a route exists", () => {
    const path = [new RoomPosition(26, 25, "W1N1"), new RoomPosition(0, 25, "W2N1")];
    stubPathFinder(() => ({ path, incomplete: false, ops: 10, cost: 10 }));

    const result = findRemotePath(new RoomPosition(25, 25, "W1N1"), new RoomPosition(1, 25, "W2N1"));

    expect(result).toBe(path);
  });

  it("returns undefined when PathFinder reports an incomplete route", () => {
    stubPathFinder(() => ({ path: [], incomplete: true, ops: 2000, cost: 0 }));

    const result = findRemotePath(new RoomPosition(25, 25, "W1N1"), new RoomPosition(1, 25, "W2N1"));

    expect(result).toBeUndefined();
  });
});

describe("serializeRemotePath / toRouteTiles", () => {
  it("agree on the path's tile length when the path crosses no exit tile", () => {
    const start = new RoomPosition(25, 25, "W1N1");
    const path = [new RoomPosition(26, 25, "W1N1"), new RoomPosition(27, 25, "W1N1")];

    expect(serializeRemotePath(start, path)).toHaveLength(path.length);
    expect(toRouteTiles(path)).toHaveLength(path.length);
  });

  it("tags each tile with the room it's actually in, across a room boundary", () => {
    const path = [new RoomPosition(26, 25, "W1N1"), new RoomPosition(2, 25, "W2N1"), new RoomPosition(1, 25, "W2N1")];

    expect(toRouteTiles(path)).toEqual([
      { room: "W1N1", x: 26, y: 25 },
      { room: "W2N1", x: 2, y: 25 },
      { room: "W2N1", x: 1, y: 25 }
    ]);
  });

  it("excludes the start position, matching PathFinder's own path shape", () => {
    const start = new RoomPosition(25, 25, "W1N1");
    const path = [new RoomPosition(26, 25, "W1N1")];

    expect(toRouteTiles(path)).not.toContainEqual({ room: start.roomName, x: start.x, y: start.y });
  });

  // Every room-crossing path passes through an exit tile on each side of the border, and Screeps
  // refuses any construction site on one — left in, building.ts's one-source-group-at-a-time gate
  // would treat the source's whole route as permanently unbuildable and stall every later source.
  it("excludes exit tiles (x/y at 0 or 49) from the buildable route, on both sides of a border", () => {
    const path = [
      new RoomPosition(48, 25, "W1N1"),
      new RoomPosition(49, 25, "W1N1"), // exit, W1N1 side
      new RoomPosition(0, 25, "W2N1"), // exit, W2N1 side
      new RoomPosition(1, 25, "W2N1")
    ];

    expect(toRouteTiles(path)).toEqual([
      { room: "W1N1", x: 48, y: 25 },
      { room: "W2N1", x: 1, y: 25 }
    ]);
  });

  it("excludes exit tiles at the top/bottom border the same way as left/right", () => {
    const path = [
      new RoomPosition(25, 48, "W1N1"),
      new RoomPosition(25, 49, "W1N1"),
      new RoomPosition(25, 0, "W3N1"),
      new RoomPosition(25, 1, "W3N1")
    ];

    expect(toRouteTiles(path)).toEqual([
      { room: "W1N1", x: 25, y: 48 },
      { room: "W3N1", x: 25, y: 1 }
    ]);
  });
});

describe("resolvePathToSource", () => {
  beforeEach(clearTiles);

  it("reuses a cached path/route without calling PathFinder", () => {
    const scouted: ScoutedSource = {
      id: "s1" as Id<Source>,
      x: 25,
      y: 25,
      paths: { W1N1: "121" },
      route: { W1N1: [{ room: "W2N1", x: 1, y: 25 }] }
    };
    // No stubPathFinder(): PathFinder.search would throw if this hit it.
    const result = resolvePathToSource("W1N1", { x: 25, y: 25 }, "W2N1", scouted);
    expect(result).toEqual({ distance: 3, route: [{ room: "W2N1", x: 1, y: 25 }] });
  });

  it("recomputes and caches both fields when only the digit-string cache is present", () => {
    const scouted: ScoutedSource = {
      id: "s1" as Id<Source>,
      x: 25,
      y: 25,
      paths: { W1N1: "121" } // pre-existing, no route sibling
    };
    const path = [new RoomPosition(26, 25, "W1N1")];
    stubPathFinder(() => ({ path, incomplete: false, ops: 10, cost: 10 }));

    const result = resolvePathToSource("W1N1", { x: 25, y: 25 }, "W2N1", scouted);

    expect(result).toEqual({ distance: path.length, route: [{ room: "W1N1", x: 26, y: 25 }] });
    expect(scouted.paths?.W1N1).toHaveLength(path.length);
    expect(scouted.route?.W1N1).toEqual([{ room: "W1N1", x: 26, y: 25 }]);
  });

  it("computes and caches fresh when nothing is cached yet", () => {
    const scouted: ScoutedSource = { id: "s1" as Id<Source>, x: 25, y: 25 };
    const path = [new RoomPosition(26, 25, "W1N1"), new RoomPosition(1, 25, "W2N1")];
    stubPathFinder(() => ({ path, incomplete: false, ops: 10, cost: 10 }));

    const result = resolvePathToSource("W1N1", { x: 25, y: 25 }, "W2N1", scouted);

    expect(result?.distance).toBe(path.length);
    expect(scouted.paths?.W1N1).toBeDefined();
    expect(scouted.route?.W1N1).toBeDefined();
  });

  it("returns undefined and caches nothing when PathFinder can't reach the source", () => {
    const scouted: ScoutedSource = { id: "s1" as Id<Source>, x: 25, y: 25 };
    stubPathFinder(() => ({ path: [], incomplete: true, ops: 2000, cost: 0 }));

    const result = resolvePathToSource("W1N1", { x: 25, y: 25 }, "W2N1", scouted);

    expect(result).toBeUndefined();
    expect(scouted.paths).toBeUndefined();
    expect(scouted.route).toBeUndefined();
  });
});
