// Bunker anchor search + coordinate stamping — pure, fixture-only (no Game access).
// Ported from legacy/empire/operations/Operations/roomPlanner/{Bunker.ts,RoomPlannerUtils.ts}.

import { range, type XY } from "../lib/geometry";
import type { GoalPlacement } from "./sync";

export interface PlacedStructure extends XY {
  type: BuildableStructureConstant;
}

// Largest bunker footprint across all RCL layouts (Base_7.json, RCL8, spans
// -6..6): a candidate anchor must fit this radius even at low RCL, otherwise
// the bunker would need to be re-anchored on every expansion.
export const BUNKER_RADIUS = 6;

// Reads real room terrain into the walkability grid distanceTransform expects.
// The only function here that touches Game — not unit tested (fixture-only
// rule applies to the pure planning logic above), exercised via integration
// tests instead. Ported verbatim from Bunker.walkablePixelsForRoom.
export function walkablePixelsForRoom(roomName: string): Uint8Array {
  const array = new Uint8Array(2500);
  for (let x = 0; x < 50; ++x) {
    for (let y = 0; y < 50; ++y) {
      array[x * 50 + y] = Game.map.getTerrainAt(x, y, roomName) !== "wall" ? 1 : 0;
    }
  }
  return array;
}

// Two-pass Chebyshev distance transform: for each open tile, the distance to
// the nearest wall (or room edge). Ported verbatim from Bunker.distanceTransform.
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

// Every tile whose distance-to-wall is at least bunkerRadius: the bunker's
// footprint (radius bunkerRadius, centered on the anchor) is fully open there.
// Legacy code disagreed on the boundary condition (Bunker.doTransform used
// `>= 6`, RoomPlannerUtils.doTransform used `> BUNKER_RADIUS`) — `>=` is
// correct: a tile with clearance exactly equal to the radius still fits the
// footprint flush against its nearest wall.
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

// How much more the controller's distance counts than a source's when scoring
// an anchor. The bunker feeds the controller continuously (upgraders walk it
// every tick), while sources are served by dedicated haulers on roads — so the
// controller path dominates the layout's value.
export const CONTROLLER_WEIGHT = 2;

// Legacy RoomPlannerUtils.getMostCenterPos picked the candidate closest to the
// map's raw {24.5, 24.5} center — a poor proxy for a real room, since rooms
// vary widely in where their controller and sources actually sit. This picks
// the bunker-fitting candidate that minimizes weighted distance to the
// controller (heavily) plus the sources, since that's what the anchor is
// actually optimizing for.
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

// Translates anchor-relative placements (from buildableAtRcl) onto an absolute
// anchor position, yielding the concrete room coordinates to place structures
// at. Forward-apply of legacy Bunker.convertToRelative, which did the inverse.
export function stampLayout(placements: GoalPlacement[], anchor: XY): PlacedStructure[] {
  return placements.map(p => ({
    x: p.x + anchor.x,
    y: p.y + anchor.y,
    type: p.type
  }));
}
