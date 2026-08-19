// gh #55: logisticsRunner.ts's runTransport (and everything that only existed to support it) was deleted
// once Steward's own cutover (#54) confirmed it had zero live callers left — see that file's header
// before this cutover for the dead-code trail. parkNearBunker survived the deletion: it's still called
// directly by empire/creeps.ts for both Transport and Supply's "nothing assigned this tick" fallback (see
// runTransportTask/runSupplyTask's own callers). This file used to be transport.test.ts, covering
// runTransport's whole task-execution state machine; only the parkNearBunker-specific cases below survive
// that rename — they're this function's only test coverage anywhere in the suite.

import { describe, expect, it, vi } from "vitest";
import { parkNearBunker } from "../../src/behaviors/logisticsRunner";
import { clearTiles, stubTile } from "../constants";
import { stubGame } from "../helpers";

describe("parkNearBunker", () => {
  it("parks near the bunker anchor when far away and an anchor is known", () => {
    stubGame({});
    (Memory as unknown as { colonies: Record<string, { anchor: { x: number; y: number } }> }).colonies = {
      W1N1: { anchor: { x: 20, y: 20 } }
    };
    const travelTargets: { x: number; y: number }[] = [];
    const creep = {
      id: "transport1",
      name: "transport1",
      memory: { role: "transport", home: "W1N1" },
      pos: {
        x: 40,
        y: 40,
        roomName: "W1N1",
        getRangeTo: (x: number, y: number) => Math.max(Math.abs(40 - x), Math.abs(40 - y)),
        lookFor: () => []
      },
      room: { name: "W1N1", find: () => [] },
      travelTo: (t: { x: number; y: number }) => travelTargets.push({ x: t.x, y: t.y })
    } as unknown as Creep;

    parkNearBunker(creep);

    expect(travelTargets).toHaveLength(1);
    // Parks within a few tiles of the anchor (a spread-out spot, not exactly on it).
    const [target] = travelTargets;
    expect(Math.max(Math.abs(target.x - 20), Math.abs(target.y - 20))).toBeLessThanOrEqual(3);
  });

  it("does not move when already parked near the anchor", () => {
    stubGame({});
    (Memory as unknown as { colonies: Record<string, { anchor: { x: number; y: number } }> }).colonies = {
      W1N1: { anchor: { x: 20, y: 20 } }
    };
    const travelTargets: { x: number; y: number }[] = [];
    const creep = {
      id: "transport1",
      name: "transport1",
      memory: { role: "transport", home: "W1N1" },
      pos: {
        x: 21,
        y: 20, // already adjacent to the anchor
        roomName: "W1N1",
        getRangeTo: (x: number, y: number) => Math.max(Math.abs(21 - x), Math.abs(20 - y)),
        lookFor: () => []
      },
      room: { name: "W1N1", find: () => [] },
      travelTo: (t: { x: number; y: number }) => travelTargets.push({ x: t.x, y: t.y })
    } as unknown as Creep;

    parkNearBunker(creep);

    expect(travelTargets).toHaveLength(0);
  });

  it("steps off the anchor tile when parked on a road another mover needs (confirmed live deadlock: a parked supply creep squatting on the sole tile adjacent to an extension permanently blocked a sibling's delivery there)", () => {
    stubGame({ rooms: { W1N1: { getTerrain: () => ({ get: () => 0 }) } } });
    (Memory as unknown as { colonies: Record<string, { anchor: { x: number; y: number } }> }).colonies = {
      W1N1: { anchor: { x: 20, y: 20 } }
    };
    clearTiles();
    stubTile("W1N1", 20, 20, { structure: [{ structureType: STRUCTURE_ROAD }] });
    stubTile("W1N1", 21, 20, { creep: [{ id: "other", memory: { role: "transport" } }] }); // wants through

    const travelTo = vi.fn();
    const creep = {
      id: "transport1",
      name: "transport1",
      memory: { role: "transport", home: "W1N1" },
      pos: new RoomPosition(20, 20, "W1N1"), // sitting right on the anchor road tile
      room: { name: "W1N1", find: () => [] },
      travelTo
    } as unknown as Creep;

    parkNearBunker(creep);

    expect(travelTo).toHaveBeenCalledTimes(1);
    const dest = (travelTo.mock.calls[0] as [RoomPosition])[0];
    expect(dest.isEqualTo(new RoomPosition(20, 20, "W1N1"))).toBe(false);
  });

  it("does nothing (no crash) when no anchor is known yet", () => {
    stubGame({});
    (Memory as unknown as { colonies: Record<string, unknown> }).colonies = {};
    const travelTargets: { x: number; y: number }[] = [];
    const creep = {
      id: "transport1",
      name: "transport1",
      memory: { role: "transport", home: "W1N1" },
      pos: {
        x: 25,
        y: 25,
        roomName: "W1N1",
        getRangeTo: () => 0,
        lookFor: () => []
      },
      room: { name: "W1N1", find: () => [] },
      travelTo: (t: { x: number; y: number }) => travelTargets.push({ x: t.x, y: t.y })
    } as unknown as Creep;

    parkNearBunker(creep);

    expect(travelTargets).toHaveLength(0);
  });
});
