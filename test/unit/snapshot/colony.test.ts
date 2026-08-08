// drainOccupancyFor (src/snapshot/colony.ts) feeds squadCostMatrix.ts's footprint-fit check (via
// operations/drain.ts's occupancy()) — any tile it fails to mark occupied reads as free ground to
// findSquadPath, which will happily route a squad's formation slot onto it. Confirmed live (real-engine
// integration test, test/integration/drain-squad-border-crossing.test.ts): a squad's own STAGING room has
// a natural Source sitting in the formation's advance path; the squad routed a trailing healer's slot
// directly onto it, and the real engine's move-conflict resolution (@screeps/engine's movement.js,
// checkObstacleAtXY) silently rejected JUST that one member's move intent (source is in the real engine's
// OBSTACLE_OBJECT_TYPES) while its squadmates' moves succeeded — breaking mutual-range-1 for one tick, with
// no planning-level bug anywhere (planSquadMove/advanceOnto computed the objectively correct next slot;
// the input feeding the pathfinder was just missing an obstacle the real engine already knew about).

import { describe, expect, it } from "vitest";
import { drainOccupancyFor } from "../../../src/snapshot/colony";
import { stubGame } from "../../helpers";

// A minimal room stub whose find() dispatches by FIND_* type, same convention as execute.test.ts's
// stubScoutRoom — only what drainOccupancyFor actually reads (FIND_CREEPS/FIND_STRUCTURES/FIND_SOURCES/
// FIND_MINERALS).
function stubRoom(opts: {
  creeps?: Array<{ x: number; y: number }>;
  structures?: Array<{ x: number; y: number; structureType: string }>;
  sources?: Array<{ x: number; y: number }>;
  minerals?: Array<{ x: number; y: number }>;
}): unknown {
  const creeps = (opts.creeps ?? []).map(c => ({ pos: { x: c.x, y: c.y } }));
  const structures = (opts.structures ?? []).map(s => ({ pos: { x: s.x, y: s.y }, structureType: s.structureType }));
  const sources = (opts.sources ?? []).map(s => ({ pos: { x: s.x, y: s.y } }));
  const minerals = (opts.minerals ?? []).map(m => ({ pos: { x: m.x, y: m.y } }));
  return {
    find: (type: number) =>
      type === FIND_CREEPS ? creeps : type === FIND_STRUCTURES ? structures : type === FIND_SOURCES ? sources : type === FIND_MINERALS ? minerals : []
  };
}

describe("drainOccupancyFor", () => {
  it("marks a natural Source tile occupied, not just structures/creeps", () => {
    stubGame({ rooms: { W1N1: stubRoom({ sources: [{ x: 4, y: 15 }] }) } });

    const grid = drainOccupancyFor("W2N1", [{ room: "W1N1" }])["W1N1"];

    expect(grid).toBeDefined();
    expect(grid![4 * 50 + 15]).toBe(1);
  });

  it("marks a Mineral tile occupied", () => {
    stubGame({ rooms: { W1N1: stubRoom({ minerals: [{ x: 10, y: 20 }] }) } });

    const grid = drainOccupancyFor("W2N1", [{ room: "W1N1" }])["W1N1"];

    expect(grid).toBeDefined();
    expect(grid![10 * 50 + 20]).toBe(1);
  });

  it("still marks live creeps and OBSTACLE_OBJECT_TYPES structures occupied (pre-existing behavior unchanged)", () => {
    stubGame({
      rooms: {
        W1N1: stubRoom({
          creeps: [{ x: 1, y: 1 }],
          structures: [
            { x: 2, y: 2, structureType: "tower" },
            { x: 3, y: 3, structureType: "road" } // NOT in OBSTACLE_OBJECT_TYPES — must stay walkable
          ]
        })
      }
    });

    const grid = drainOccupancyFor("W2N1", [{ room: "W1N1" }])["W1N1"];

    expect(grid).toBeDefined();
    expect(grid![1 * 50 + 1]).toBe(1); // creep
    expect(grid![2 * 50 + 2]).toBe(1); // tower (obstacle structure)
    expect(grid![3 * 50 + 3]).toBe(0); // road stays walkable
  });

  it("leaves a tile with nothing on it clear", () => {
    stubGame({ rooms: { W1N1: stubRoom({ sources: [{ x: 4, y: 15 }] }) } });

    const grid = drainOccupancyFor("W2N1", [{ room: "W1N1" }])["W1N1"];

    expect(grid![0]).toBe(0);
  });
});
