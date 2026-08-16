// Room-scoped cost matrix + real-engine distance queries, shared by any hot-path caller that needs
// "how far, walking, from A to B" without hand-rolling a search. Distinct from construction/roadPathing.ts,
// which hand-rolls its own A* (findPath) purely so road-building stays unit-testable without the engine —
// pathDistance/pathDistanceAndStand call the real PathFinder.search instead: they're invoked
// O(idle creeps x providers/consumers) times per tick by the logistics allocator (see logistics/allocate.ts),
// and the engine's native search is far cheaper per call than even a fast JS A* at that volume — confirmed
// live (2026-08-13) as the dominant cause of intermittent operations-tier CPU spikes.
// Testable the same way src/lib/squadPath.ts is: test/constants.ts's stubPathFinderSingleRoom() runs a
// real Dijkstra over whatever CostMatrix the roomCallback below builds, so wall-awareness is still
// genuinely exercised in unit tests, not mocked away.

import type { XY } from "./geometry";

const PLAIN_COST = 2;

// Mirrors PathFinder.CostMatrix's get/set shape without depending on the game runtime.
export class RoadCostMatrix {
  private readonly costs = new Uint8Array(2500);

  get(x: number, y: number): number {
    return this.costs[x * 50 + y];
  }

  set(x: number, y: number, cost: number): void {
    this.costs[x * 50 + y] = cost;
  }
}

// Builds a real PathFinder.CostMatrix from a RoadCostMatrix's costs, for handing to PathFinder.search's
// roomCallback — the engine's own matrix type, not this module's plain get/set stand-in for it.
function toPathFinderMatrix(cm: RoadCostMatrix): CostMatrix {
  const matrix = new PathFinder.CostMatrix();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const cost = cm.get(x, y);
      if (cost !== 0) matrix.set(x, y, cost);
    }
  }
  return matrix;
}

// Real walkable-tile distance from `from` to within `range` of `to` — terrain/structure-aware, unlike
// a Chebyshev/linear-distance guess. Restricted to one room via maxRooms. `room` must be the REAL room
// both positions live in (every real caller only ever compares distances within one colony's home room)
// — confirmed live (2026-08-13) that a fake placeholder room name breaks PathFinder.search against the
// real engine (silently very slow/wrong), even though it's invisible to the unit-test stub, which doesn't
// validate room existence. Infinity when `to` is unreachable (e.g. walled off), so callers can treat it
// like a missing candidate rather than special-casing an empty path.
export function pathDistance(from: XY, to: XY, range: number, cm: RoadCostMatrix, room: string): number {
  const result = PathFinder.search(
    new RoomPosition(from.x, from.y, room),
    { pos: new RoomPosition(to.x, to.y, room), range },
    { maxRooms: 1, plainCost: PLAIN_COST, swampCost: PLAIN_COST, roomCallback: () => toPathFinderMatrix(cm) }
  );
  if (result.incomplete && result.path.length === 0) return Infinity;
  return result.path.length;
}

// Same query as pathDistance, but also returns the actual tile the path stops on — the tile within
// `range` of `to` that PathFinder.search halted at, i.e. where a creep doing this walk would really be
// standing, NOT `to` itself. At PICKUP_RANGE (1) a creep withdrawing/transferring/delivering never
// stands on the structure it's acting on, so chaining a next leg from `to` instead of this stand tile
// misjudges the following hop by up to `range` tiles. `null` when `to` is unreachable. `room`: see
// pathDistance's doc — must be the real room, not a placeholder.
export function pathDistanceAndStand(from: XY, to: XY, range: number, cm: RoadCostMatrix, room: string): { distance: number; stand: XY } | null {
  const result = PathFinder.search(
    new RoomPosition(from.x, from.y, room),
    { pos: new RoomPosition(to.x, to.y, room), range },
    { maxRooms: 1, plainCost: PLAIN_COST, swampCost: PLAIN_COST, roomCallback: () => toPathFinderMatrix(cm) }
  );
  if (result.incomplete && result.path.length === 0) return null;
  const last = result.path[result.path.length - 1] ?? from;
  return { distance: result.path.length, stand: { x: last.x, y: last.y } };
}
