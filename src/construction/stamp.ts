// Bunker anchor search + coordinate stamping — pure, fixture-only (no Game access).

import { range, type XY } from "../lib/geometry";
import type { GoalPlacement } from "./sync";

export interface PlacedStructure extends XY {
  type: BuildableStructureConstant;
  // Both optional and additive: every existing producer (bunker layout stamping, controller road/
  // container claims) is implicitly home-room and ungrouped, so none of them need to change.
  room?: string; // defaults to the colony's home room when absent
  sourceId?: Id<Source>; // which source's route this tile belongs to, if any — see construction/planner.ts
}

// Largest bunker footprint across all RCL layouts: the outermost road sits at Chebyshev distance 6
// from the anchor. distanceTransform's value D at a tile means the nearest wall is exactly D tiles
// away, so only tiles through range D-1 are guaranteed open — range D itself may be the wall. D=7
// guarantees that outer road (range 6) is open.
export const BUNKER_RADIUS = 7;

// The only function here that touches Game — exercised via integration tests, not unit tests.
export function walkablePixelsForRoom(roomName: string): Uint8Array {
  const array = new Uint8Array(2500);
  const terrain = Game.map.getRoomTerrain(roomName);
  for (let x = 0; x < 50; ++x) {
    for (let y = 0; y < 50; ++y) {
      array[x * 50 + y] = terrain.get(x, y) !== TERRAIN_MASK_WALL ? 1 : 0;
    }
  }
  return array;
}

// Two-pass Chebyshev distance transform: for each open tile, the distance to the nearest wall (or room edge).
export function distanceTransform(array: Uint8Array, oob = -1): Uint8Array {
  let A;
  let B;
  let D;
  let G;
  for (let n = 0; n < 2500; n++) {
    if (array[n] !== 0) {
      A = array[n - 51];
      B = array[n - 1];
      D = array[n - 50];
      G = array[n - 49];
      if (n % 50 === 0) {
        A = oob;
        B = oob;
      }
      if (n % 50 === 49) {
        G = oob;
      }
      if (~~(n / 50) === 0) {
        A = oob;
        D = oob;
        G = oob;
      }
      array[n] = Math.min(A, B, D, G, 254) + 1;
    }
  }

  let C;
  let E;
  let F;
  let H;
  let I;
  let value;
  for (let n = 2499; n >= 0; n--) {
    C = array[n + 49];
    E = array[n];
    F = array[n + 50];
    H = array[n + 1];
    I = array[n + 51];
    if (n % 50 === 0) {
      C = oob;
    }
    if (n % 50 === 49) {
      H = oob;
      I = oob;
    }
    if (~~(n / 50) === 49) {
      C = oob;
      F = oob;
      I = oob;
    }
    value = Math.min(C + 1, E, F + 1, H + 1, I + 1);
    array[n] = value;
  }

  return array;
}

// Every tile whose distance-to-wall is at least bunkerRadius (footprint fits flush against the wall).
export function findAnchorCandidates(terrain: Uint8Array, bunkerRadius = BUNKER_RADIUS): XY[] {
  const dt = distanceTransform(terrain.slice());
  const out: XY[] = [];
  for (let n = 0; n < dt.length; n++) {
    if (dt[n] >= bunkerRadius) {
      out.push({ x: Math.floor(n / 50), y: n % 50 });
    }
  }
  return out;
}

export interface AnchorRoom {
  controller: XY;
  sources: XY[];
}

export const CONTROLLER_WEIGHT = 2; // controller path dominates scoring: upgraders walk it every tick

// Picks the bunker-fitting candidate minimizing weighted distance to the controller (heavily) plus the sources.
export function pickAnchor(candidates: XY[], room: AnchorRoom): XY | null {
  let best: XY | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    let score = CONTROLLER_WEIGHT * range(c, room.controller);
    for (const source of room.sources) {
      score += range(c, source);
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// Translates anchor-relative placements onto an absolute anchor position.
export function stampLayout(placements: GoalPlacement[], anchor: XY): PlacedStructure[] {
  return placements.map(p => ({
    x: p.x + anchor.x,
    y: p.y + anchor.y,
    type: p.type
  }));
}
