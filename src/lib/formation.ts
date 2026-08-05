// Formation-as-data (ADR 0007): a Formation is a list of slots, each an (dx, dy) offset from a designated
// anchor slot at a canonical facing (TOP), plus the role that fills it. slotTiles rotates those offsets
// to any of the 8 compass facings and places them at a concrete anchor tile — a pure geometric transform,
// no Game object, no creep stubs. Replaces the old hardcoded 2x2 QUADRANT/followerOffsets table: the same
// machinery now serves Drain's 2x2 and any future squad's different size/composition. A formation's own
// facing-selection (e.g. a strict 2x2's collapse of the 8 travel directions to its 4 distinct
// orientations, for mutual range-1) belongs in that formation's own definition, NOT baked in here.

import { type XY } from "./geometry";

export interface FormationSlot {
  dx: number; // offset from the anchor slot, measured at the canonical TOP facing
  dy: number;
  role: string; // matched against a creep's role/memory when assigning members to slots
}

export type Formation = FormationSlot[];

// A slot tile carries its role so a caller can match a creep to the slot it belongs in.
export interface SlotTile extends XY {
  room: string;
  role: string;
}

// The canonical facing every formation's offsets are defined at. Rotating to any other facing is a pure
// rotation of each (dx, dy) about the anchor by the angle from TOP.
export const CANONICAL_FACING: DirectionConstant = TOP;

// Screeps' 8-direction compass, clockwise from TOP. The index is the number of 45-degree steps clockwise
// from the canonical TOP facing — TOP is 0 steps, RIGHT is 2 steps (90 degrees), etc.
const CW_STEPS: Record<DirectionConstant, number> = {
  [TOP]: 0,
  [TOP_RIGHT]: 1,
  [RIGHT]: 2,
  [BOTTOM_RIGHT]: 3,
  [BOTTOM]: 4,
  [BOTTOM_LEFT]: 5,
  [LEFT]: 6,
  [TOP_LEFT]: 7
};

/** Rotates an offset vector clockwise by the angle between the canonical TOP facing and `facing`. In
 * screeps' screen space y grows downward, so a clockwise screen rotation by theta is
 * (dx', dy') = (dx*cos - dy*(-sin), ...) — worked out here as the standard rotation with sin's sign set
 * for the y-down axis. Axis-aligned facings (TOP/RIGHT/BOTTOM/LEFT) produce exact integer results; the
 * diagonal facings rotate by 45 degrees and are rounded to the nearest tile (a formation that needs its
 * slots to stay on exact tiles at diagonal facings should restrict itself to axis-aligned facings in its
 * own facing-selection — see the module header). */
export function rotateOffset(offset: { dx: number; dy: number }, facing: DirectionConstant): { dx: number; dy: number } {
  const theta = (CW_STEPS[facing] * Math.PI) / 4;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Clockwise rotation in a y-down coordinate system: x' = x*cos - y*sin, y' = x*sin + y*cos.
  const dx = offset.dx * cos - offset.dy * sin;
  const dy = offset.dx * sin + offset.dy * cos;
  // Round away tiny floating error at axis-aligned facings, and snap 45-degree diagonals to the grid.
  // `+ 0` normalizes a rounded -0 back to 0 so equality checks don't distinguish the two.
  return { dx: Math.round(dx) + 0, dy: Math.round(dy) + 0 };
}

/** The concrete tiles a formation occupies with its anchor slot at `anchor`, facing `facing`. Each
 * returned tile carries its slot's role. Pure — no Game access, no bounds/terrain check (that's the
 * pather's job, see squadPath.ts). Tiles are returned in formation-definition order, anchor first when
 * the anchor slot is at index 0 (the convention Drain's formation uses). */
export function slotTiles(anchor: XY & { room: string }, facing: DirectionConstant, formation: Formation): SlotTile[] {
  return formation.map(slot => {
    const r = rotateOffset(slot, facing);
    return { x: anchor.x + r.dx, y: anchor.y + r.dy, room: anchor.room, role: slot.role };
  });
}
