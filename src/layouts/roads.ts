// Cost-matrix construction + road pathing for connecting a stamped bunker (stamp.ts) to sources
// and the controller. Road-building (sourceRoadPath/controllerRoadPath/controllerContainerPath) is
// pure/unit-testable — no Game access, via the hand-rolled findPath below. pathDistance/
// pathDistanceAndStand (the logistics allocator's hot-path distance queries — see logistics/allocate.ts)
// instead call the real PathFinder.search: they're invoked O(idle creeps x providers/consumers) times
// per tick, and the engine's native search is far cheaper per call than even a fast JS A* at that volume
// — confirmed live (2026-08-13) as the dominant cause of intermittent operations-tier CPU spikes.
// Testable the same way src/lib/squadPath.ts is: test/constants.ts's stubPathFinderSingleRoom() runs a
// real Dijkstra over whatever CostMatrix the roomCallback below builds, so wall-awareness is still
// genuinely exercised in unit tests, not mocked away.

import type { XY } from "../lib/geometry";
import type { PlacedStructure } from "./stamp";

const IMPASSABLE = 255;
const ROAD_COST = 1;
// Strictly more than ROAD_COST so an A* tie always prefers reusing a built/planned road over cutting
// a fresh line across raw ground — otherwise a route can drift off already-built infrastructure on
// any equal-length alternative, stranding the old road unclaimed and getting it demolished as stale.
const PLAIN_COST = 2;

// A miner stands *on* its container while working, so it must not be treated as an obstacle.
const WALKABLE_STRUCTURES = new Set<BuildableStructureConstant>(["road", "container", "rampart"]);

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

export interface RoomFixture {
  terrain: Uint8Array; // 1 = walkable, 0 = wall, indexed [x*50+y]
  structures: PlacedStructure[];
}

// A* without a binary heap (linear scan is cheap enough for a 50x50 room). Finds the cheapest
// path from `from` to any tile within `range` of `to`, 8-directional movement.
function findPath(from: XY, to: XY, range: number, cm: RoadCostMatrix): XY[] {
  const key = (p: XY): number => p.x * 50 + p.y;
  const withinRange = (p: XY): boolean =>
    Math.max(Math.abs(p.x - to.x), Math.abs(p.y - to.y)) <= range;

  const open = new Map<number, XY>();
  open.set(key(from), from);
  const cameFrom = new Map<number, XY>();
  const gScore = new Map<number, number>([[key(from), 0]]);
  const fScore = new Map<number, number>([[key(from), heuristic(from, to)]]);

  while (open.size > 0) {
    let currentKey = -1;
    let current: XY | null = null;
    let bestF = Infinity;
    for (const [k, p] of open) {
      const f = fScore.get(k) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        currentKey = k;
        current = p;
      }
    }
    if (current === null) break;

    if (withinRange(current)) {
      return reconstructPath(cameFrom, current);
    }

    open.delete(currentKey);

    for (const neighbor of neighbors(current)) {
      if (neighbor.x < 0 || neighbor.x > 49 || neighbor.y < 0 || neighbor.y > 49) continue;
      const cost = cm.get(neighbor.x, neighbor.y);
      if (cost >= IMPASSABLE) continue;

      const nKey = key(neighbor);
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + cost;
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, current);
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + heuristic(neighbor, to));
        open.set(nKey, neighbor);
      }
    }
  }

  return [];
}

function heuristic(a: XY, b: XY): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function neighbors(p: XY): XY[] {
  const out: XY[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      out.push({ x: p.x + dx, y: p.y + dy });
    }
  }
  return out;
}

function reconstructPath(cameFrom: Map<number, XY>, end: XY): XY[] {
  const path: XY[] = [end];
  let currentKey = end.x * 50 + end.y;
  let prev = cameFrom.get(currentKey);
  while (prev) {
    path.unshift(prev);
    currentKey = prev.x * 50 + prev.y;
    prev = cameFrom.get(currentKey);
  }
  return path;
}

export interface RoadPathResult {
  path: XY[];
  structurePos: XY;
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
// a Chebyshev/linear-distance guess. Backed by the engine's own PathFinder.search (see this file's
// header for why, unlike road-building below, this doesn't use the hand-rolled findPath), restricted to
// one room via maxRooms. `room` must be the REAL room both positions live in (every real caller only
// ever compares distances within one colony's home room) — confirmed live (2026-08-13) that a fake
// placeholder room name breaks PathFinder.search against the real engine (silently very slow/wrong),
// even though it's invisible to the unit-test stub, which doesn't validate room existence.
// Infinity when `to` is unreachable (e.g. walled off), so callers can treat it like a missing candidate
// rather than special-casing an empty path.
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

function roadPathTo(anchor: XY, target: XY, range: number, costMatrix: RoadCostMatrix): RoadPathResult {
  const path = findPath(anchor, target, range, costMatrix);
  const structurePos = path[path.length - 1];
  return { path, structurePos };
}

export function sourceRoadPath(anchor: XY, source: XY, costMatrix: RoadCostMatrix): RoadPathResult {
  return roadPathTo(anchor, source, 1, costMatrix);
}

// Screeps' UPGRADE_CONTROLLER_RANGE.
const UPGRADE_CONTROLLER_RANGE = 3;

export function controllerRoadPath(anchor: XY, controller: XY, costMatrix: RoadCostMatrix): RoadPathResult {
  return roadPathTo(anchor, controller, UPGRADE_CONTROLLER_RANGE, costMatrix);
}

// The upgrade container sits adjacent to the controller (range 1, not the full range-3 upgrade
// range) so an upgrader standing on it is still in range of the controller with room to spare.
// Pathed from `from` (the storage tile) so the returned path's road tiles connect the container
// back toward storage; the last tile is the container.
const UPGRADE_CONTAINER_RANGE = 1;

export function controllerContainerPath(from: XY, controller: XY, costMatrix: RoadCostMatrix): RoadPathResult {
  return roadPathTo(from, controller, UPGRADE_CONTAINER_RANGE, costMatrix);
}

export function buildCostMatrix(room: RoomFixture): RoadCostMatrix {
  const cm = new RoadCostMatrix();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      cm.set(x, y, room.terrain[x * 50 + y] === 0 ? IMPASSABLE : PLAIN_COST);
    }
  }
  for (const s of room.structures) {
    // A road claim can never make a real wall tile walkable — Screeps refuses a road construction site
    // on a wall in the first place, so a "road" entry landing there is always bogus input (e.g. a
    // caller accidentally mixing in a claim from a different room whose coordinates happen to collide
    // with this room's — confirmed live on W47N14 2026-08-13, where a remote-route road claim leaked
    // into the home room's structures list this way and let A* "tunnel" straight through a wall). Wall
    // terrain wins over any structure entry, road included.
    if (room.terrain[s.x * 50 + s.y] === 0) continue;
    if (s.type === "road") {
      cm.set(s.x, s.y, ROAD_COST);
    } else if (!WALKABLE_STRUCTURES.has(s.type)) {
      cm.set(s.x, s.y, IMPASSABLE);
    }
  }
  return cm;
}
