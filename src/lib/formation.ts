// Formation-as-data (ADR 0007): a Formation is a list of slots, each a FIXED (dx, dy) offset from the
// anchor slot, plus the role that fills it. There is no facing/rotation concept at this layer at all — the
// box's tile-set relative to the anchor never changes, by construction (see assertSquareTopLeftAnchor
// below). slotTiles places those fixed offsets at a concrete anchor tile — a pure geometric transform, no
// Game object, no creep stubs. Replaces the old hardcoded 2x2 QUADRANT/followerOffsets table: the same
// machinery now serves Drain's 2x2 and any future squad's different size/composition. Any "facing" a squad
// wants (e.g. Drain's attacker facing the nearest threat) is a MEMBER-TO-TILE ASSIGNMENT preference —
// which live creep goes to which already-fixed tile — resolved entirely by the operation that wants it
// (see operations/drain.ts), never a rotation of the tiles themselves.

import { roomAndLocal, worldOf, type XY } from "./geometry";

export interface FormationSlot {
  dx: number; // fixed offset from the anchor slot — never rotated
  dy: number;
  role: string; // matched against a creep's role/memory when assigning members to slots
}

export type Formation = FormationSlot[];

// A slot tile carries its role so a caller can match a creep to the slot it belongs in.
export interface SlotTile extends XY {
  room: string;
  role: string;
}

/** Builds a plain square block Formation from an "<n>x<n>" shape string (e.g. "2x2", "3x3"), every slot
 * filled with `role` — Parade's formation is just a marching block, no role differentiation within it
 * (unlike Drain's attacker/healer split), so one shared role string is enough. The anchor slot is the
 * block's own top-left tile (dx=0, dy=0 at the canonical TOP facing), matching DRAIN_FORMATION's convention
 * of anchor-first/top-left. Returns undefined for a malformed string, a non-positive dimension, or a
 * NON-SQUARE shape (cols !== rows) — squad pathing (squadPath.ts/squadCostMatrix.ts) requires every
 * formation's bounding box to be square with the anchor at its own top-left corner (assertSquareTopLeftAnchor
 * below), so this rejects a bad shape at the player-facing boundary (a flag name typo) rather than letting
 * an invalid formation reach that assertion. The caller (paradeFlags.ts) falls back to a default shape
 * rather than crashing on a player's typo in a flag name. */
export function parseRectFormation(shape: string, role: string): Formation | undefined {
  const m = /^(\d+)x(\d+)$/.exec(shape.trim());
  if (!m) return undefined;
  const cols = Number(m[1]);
  const rows = Number(m[2]);
  if (cols <= 0 || rows <= 0 || cols !== rows) return undefined;
  const slots: Formation = [];
  for (let dy = 0; dy < rows; dy++) {
    for (let dx = 0; dx < cols; dx++) {
      slots.push({ dx, dy, role });
    }
  }
  return slots;
}

/** Asserts `formation`'s bounding box is a square with slot 0 at the box's own top-left corner (0,0) and no
 * slot behind it (dx < 0 or dy < 0) — the constraint every squad formation must hold so pathing
 * (squadPath.ts/squadCostMatrix.ts) never needs to know facing at all: a square anchored at its own corner
 * occupies the IDENTICAL tile-set relative to the anchor at every rotation, unlike an off-corner anchor
 * (whose position within its own bounding box changes per facing — see docs/adr/0007-squad-movement.md's
 * follow-up, and squadCostMatrix.ts's now-simplified cache key). Overmind (the reference implementation)
 * gets this same invariant for free by defining its anchor as always the box's top-left corner, recomputed
 * per orientation; constraining every formation to a square lets THIS codebase keep one fixed anchor value
 * across every orientation instead, with no per-orientation recomputation needed at all.
 *
 * Called once, at each formation's own DEFINITION site (DRAIN_FORMATION below any future hardcoded
 * formation) — not on every use — so a violation surfaces immediately at startup, not buried inside a
 * pathfinder result a tick later. Throwing here (rather than returning a boolean) matches this module's
 * existing fail-loud convention for a genuinely-impossible shape (see operations/drain.ts's anchorTile,
 * which throws on its own unreachable "no attacker, no healers" case): a malformed BUILT-IN formation is a
 * programming error, not a runtime data problem a caller should have to handle. Player-supplied shapes
 * (Parade's flag-driven "NxM" string, parseRectFormation above) validate at their OWN boundary instead —
 * rejecting a non-square shape directly and falling back to a default — so they never reach here with a bad
 * shape to begin with. */
export function assertSquareTopLeftAnchor(formation: Formation): void {
  const dxs = formation.map(s => s.dx);
  const dys = formation.map(s => s.dy);
  const width = Math.max(...dxs) - Math.min(...dxs) + 1;
  const height = Math.max(...dys) - Math.min(...dys) + 1;
  if (width !== height) {
    throw new Error(`formation must have a square bounding box, got ${width}x${height}`);
  }
  if (formation[0]?.dx !== 0 || formation[0]?.dy !== 0) {
    throw new Error("formation's slot 0 must be the anchor at (0,0)");
  }
  if (dxs.some(d => d < 0) || dys.some(d => d < 0)) {
    throw new Error("formation must have no slot behind the anchor (dx < 0 or dy < 0)");
  }
}

/** The concrete tiles a formation occupies with its anchor slot at `anchor`. Each returned tile carries
 * its slot's role. Pure — no Game access, no bounds/terrain check (that's the pather's job, see
 * squadPath.ts). Tiles are returned in formation-definition order, anchor first when the anchor slot is at
 * index 0 (the convention Drain's formation uses). There is no facing parameter: the box's tile-set is
 * fixed relative to the anchor, full stop — see the module header.
 *
 * Resolved via the shared world-coordinate lattice (geometry.ts's worldOf/roomAndLocal), NOT plain
 * anchor.x+dx in the anchor's own local space: an anchor sitting near a room's edge (x/y 0 or 49) can have
 * a slot offset push past that edge into the NEIGHBORING room. Local-only arithmetic would produce an
 * out-of-range local x/y (e.g. x=50) for that slot instead — RoomPosition's constructor throws on that,
 * which crashed the whole tick's creep loop when a live squad's anchor sat at the border (confirmed live).
 * The world lattice guarantees every slot always resolves to a real, valid tile in whichever room it
 * actually falls in, exactly like findSquadPath's own footprint checks already do. */
export function slotTiles(anchor: XY & { room: string }, formation: Formation): SlotTile[] {
  const a = worldOf(anchor.x, anchor.y, anchor.room);
  return formation.map(slot => {
    const { room, x, y } = roomAndLocal(a.wx + slot.dx, a.wy + slot.dy);
    return { x, y, room, role: slot.role };
  });
}
