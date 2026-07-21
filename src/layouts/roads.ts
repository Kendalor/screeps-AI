// Cost-matrix construction + road pathing for connecting a stamped bunker (stamp.ts) to sources
// and the controller. Pure/unit-testable — no Game access.

import type { XY } from "../lib/geometry";
import type { PlacedStructure } from "./stamp";

const IMPASSABLE = 255;
const ROAD_COST = 1;

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
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + Math.max(cost, 1);
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

export function buildCostMatrix(room: RoomFixture): RoadCostMatrix {
  const cm = new RoadCostMatrix();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (room.terrain[x * 50 + y] === 0) {
        cm.set(x, y, IMPASSABLE);
      }
    }
  }
  for (const s of room.structures) {
    if (s.type === "road") {
      cm.set(s.x, s.y, ROAD_COST);
    } else if (!WALKABLE_STRUCTURES.has(s.type)) {
      cm.set(s.x, s.y, IMPASSABLE);
    }
  }
  return cm;
}
