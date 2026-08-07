// The Squad entity's pure planning core (ADR 0007). A squad computes ONE plan for the whole formation
// each tick — every member's move is dictated by the squad, so members cannot diverge from each other by
// construction (the mechanism fix replacing per-creep independent Traveler convergence). This module is
// GENERIC infrastructure: it knows only slots, members, anchors, facings, and routing — nothing about
// towers, healing, or attackers. A squad "type" is a Formation plus a plugged-in planSquadActions
// function (Drain supplies its own), the same split RoleDef/Step draw between the generic step engine and
// each role's content. Pure: plain SquadState in, plain intents out, no Game access.

import { slotTiles, type Formation, type SlotTile } from "./formation";
import { range, roomAndLocal, worldOf, type XY } from "./geometry";
import { findSquadPath, nearestFittingAnchor, NO_OCCUPANCY, type OccupancySource, type TerrainSource } from "./squadPath";
import type { SnapCreep } from "../snapshot/types";

// The squad's shared state for a tick — every member's position/HP/role, the formation shape, the anchor
// SLOT's tile (not a creep's position: the anchor is a fixed slot that may be vacant), and its facing.
// `members` may be FEWER than formation.length (a degraded formation with vacant slots — see ADR 0007).
export interface SquadState {
  members: SnapCreep[];
  formation: Formation;
  anchor: XY & { room: string };
  facing: DirectionConstant;
}

// A resolved per-member move: the concrete tile this member should step toward this tick. Not a
// squadTargetPos for an independent Traveler to chase — the squad already decided every member's tile in
// lockstep, so a member's execution is a single move toward `to`, never its own pathfind.
export interface SquadMoveIntent {
  creep: Id<Creep>;
  to: XY & { room: string };
}

// A resolved per-member action (attack/heal/...), supplied by a squad type's own planSquadActions.
export interface ActionIntent {
  do: "attack" | "heal" | "rangedAttack" | "dismantle";
  target: Id<_HasId>;
}

// A squad type's action planner: given the shared state (and colony snapshot for context), returns one
// action per member it wants to act. Generic squad code never interprets these — it just dispatches them.
export type SquadActionPlanner = (state: SquadState, colony: import("../snapshot/types").ColonySnapshot) => Map<Id<Creep>, ActionIntent>;

/** Greedy nearest-available one-to-one assignment from each member's current tile to a destination tile.
 * Squads are small (a 6-creep squad is already large, ADR 0007), so this beats a full Hungarian solve and
 * is sufficient. Destinations are consumed as assigned — no two members ever get the same tile. The same
 * algorithm serves both the symmetric turn (members already on the destination tiles → every assignment
 * is distance 0, resolving in one tick) and the asymmetric reshape (destinations only partially overlap →
 * some members travel, multiple ticks) with no special-casing. Members are assigned in order of their
 * single best (nearest) available destination, so the tightest matches lock in first. */
export function reformAssignment(
  members: readonly { id: Id<Creep>; pos: XY }[],
  destinations: readonly XY[]
): Map<Id<Creep>, XY> {
  const assignment = new Map<Id<Creep>, XY>();
  const remaining = [...destinations];
  // Assign members greedily: repeatedly take the (member, dest) pair with the smallest distance among all
  // still-unassigned members and still-available destinations. O(n^3) but n <= ~6, so trivially cheap.
  const unassigned = [...members];
  while (unassigned.length > 0 && remaining.length > 0) {
    let bestMi = 0;
    let bestDi = 0;
    let bestDist = Infinity;
    for (let mi = 0; mi < unassigned.length; mi++) {
      for (let di = 0; di < remaining.length; di++) {
        const d = range(unassigned[mi].pos, remaining[di]);
        if (d < bestDist) {
          bestDist = d;
          bestMi = mi;
          bestDi = di;
        }
      }
    }
    const member = unassigned.splice(bestMi, 1)[0];
    const dest = remaining.splice(bestDi, 1)[0];
    assignment.set(member.id, dest);
  }
  return assignment;
}

// Whether every member currently stands exactly on one of the given slot tiles (a tight formation). Uses
// a one-to-one match: a member counts as "in place" only if it occupies a distinct slot tile. Exported
// (rather than kept module-private) solely so callers can log which planSquadMove branch fired without
// duplicating this predicate — planSquadMove itself is the only thing that should ever branch on it.
export function inFormation(members: readonly SnapCreep[], slots: readonly SlotTile[]): boolean {
  const occupied = new Set(members.map(m => `${m.room}:${m.x},${m.y}`));
  // A member is in place iff its tile is one of the slot tiles. With members <= slots and slots distinct,
  // "every member on some slot tile" is enough for a tight block (each member on a distinct slot follows
  // from slots being distinct and members not overlapping).
  const slotKeys = new Set(slots.map(s => `${s.room}:${s.x},${s.y}`));
  for (const key of occupied) if (!slotKeys.has(key)) return false;
  return true;
}

/** The one shared movement plan for the whole formation this tick. Returns one move intent per member.
 *
 * - When the block is NOT tight (a member off its slot, a straggler catching up, a replacement just
 *   joined), the anchor HOLDS and every member is assigned onto the current-facing slot tiles (greedy
 *   nearest) so the block reforms — never advances while broken. UNLESS the squad's own current
 *   anchor/facing can no longer fit the whole formation anywhere (some member shoved off, a degraded
 *   formation's inferred anchor landing in a pocket too narrow for the full shape, independent movement
 *   before joining walking it into a dead end) — reforming onto an unfittable target would hold forever, so
 *   the squad instead retargets the reform onto the NEAREST anchor/facing that does fit
 *   (nearestFittingAnchor), still never advancing toward `goal` until tight again.
 * - When the block IS tight but a member is FATIGUED (creep.fatigue > 0 — swamp, an overweight body), the
 *   squad holds at its current slots rather than advancing: a fatigued creep's move() silently no-ops this
 *   tick, so committing the whole formation to slide forward would leave that one member behind while its
 *   squadmates still moved — reintroducing per-member drift under a different mechanism than the
 *   independent-Traveler convergence ADR 0007 replaced. Waits for every member's fatigue to clear before
 *   resuming the advance.
 * - When the block IS tight and unfatigued, the anchor advances one step along a footprint-fit route toward
 *   `goal` (findSquadPath, which checks the FULL formation shape regardless of occupancy), and every member
 *   is reassigned onto the NEXT step's slot tiles — so the whole formation moves exactly one tile in
 *   lockstep. A route step that is a reform (same anchor tile, changed facing) is handled by the same
 *   reassignment. When no route exists (walled in) or the squad is already at the goal, it holds.
 *
 * Walkability is ALWAYS checked against the full formation shape (via findSquadPath), even with vacant
 * slots — a shrunk fit-check could strand a later replacement (ADR 0007). `occupancy` (optional, defaults
 * to nothing occupied) is a sibling of `terrain` — see OccupancySource's doc in squadPath.ts — letting a
 * squad route around a live bystander creep or hostile structure exactly as it would a wall; the caller is
 * responsible for excluding the squad's OWN members' current tiles from it (this function has no notion of
 * "which creep is asking"). */
export function planSquadMove(
  state: SquadState,
  goal: XY & { room: string },
  terrain: TerrainSource,
  occupancy: OccupancySource = NO_OCCUPANCY
): SquadMoveIntent[] {
  const currentSlots = slotTiles(state.anchor, state.facing, state.formation);

  // Not a tight block: hold and reform — but only onto a target the full formation can actually occupy.
  if (!inFormation(state.members, currentSlots)) {
    const fit = nearestFittingAnchor(state.anchor, state.formation, terrain, occupancy);
    const reformSlots =
      fit && (fit.anchor.x !== state.anchor.x || fit.anchor.y !== state.anchor.y || fit.facing !== state.facing)
        ? slotTiles(fit.anchor, fit.facing, state.formation)
        : currentSlots;
    return reformOnto(state.members, reformSlots);
  }

  // Tight but a member can't actually move this tick — hold rather than advance without it.
  if (state.members.some(m => m.fatigue > 0)) {
    return reformOnto(state.members, currentSlots);
  }

  // Tight block: try to advance/reform one footprint-fit step toward the goal.
  const path = findSquadPath({ anchor: state.anchor, facing: state.facing }, goal, state.formation, terrain, occupancy);
  const next = path && path.length > 1 ? path[1] : undefined;
  if (!next) {
    // Already at the goal, or no route the whole footprint can take — hold in place.
    return reformOnto(state.members, currentSlots);
  }

  const facingChanged = next.facing !== state.facing;
  if (facingChanged) {
    // A reform step: the anchor holds, the facing changes. Greedy-reassign members to the new-facing slot
    // tiles — the multi-tick reshape / one-tick symmetric turn, same mechanism.
    const nextSlots = slotTiles(next.anchor, next.facing, state.formation);
    return reformOnto(state.members, nextSlots);
  }

  // A straight advance (facing unchanged): the whole formation slides as a rigid body by the anchor's
  // delta, so every member moves the SAME one tile and relative positions are preserved — NOT a nearest-
  // slot reassignment (which would make a back-row member leapfrog two tiles to a freed front tile). Each
  // member holds its slot INDEX; its new tile is that same slot at the advanced anchor.
  //
  // The delta is computed and applied in WORLD coordinates (worldOf/roomAndLocal, geometry.ts), never plain
  // local x/y: state.anchor and next.anchor can straddle a room border (the anchor itself crossing between
  // consecutive path steps), so a raw local subtraction is meaningless once the two anchors are in different
  // rooms — and even before the ANCHOR crosses, an individual trailing SLOT can already be in a different
  // room than the anchor (slotTiles resolves each slot through this same world lattice for exactly that
  // reason). A single `room` stamped onto every member's result — the bug this replaces — silently produced
  // an out-of-range local x/y (e.g. x=50) or mislabeled a genuinely-crossed member as still in the old room,
  // the same crash/corruption class as the cross-border slot-placement bug fixed in slotTiles (see
  // formation.ts's doc) recurring here via the advance path instead of the reform path.
  const anchorDelta = (() => {
    const a = worldOf(state.anchor.x, state.anchor.y, state.anchor.room);
    const b = worldOf(next.anchor.x, next.anchor.y, next.anchor.room);
    return { dwx: b.wx - a.wx, dwy: b.wy - a.wy };
  })();
  const slotIndexByMember = assignMembersToSlotIndices(state.members, currentSlots);
  return state.members.map(m => {
    const idx = slotIndexByMember.get(m.id);
    const slot = idx !== undefined ? currentSlots[idx] : { x: m.x, y: m.y, room: m.room };
    const slotRoom = idx !== undefined ? currentSlots[idx].room : m.room;
    const w = worldOf(slot.x, slot.y, slotRoom);
    const { room, x, y } = roomAndLocal(w.wx + anchorDelta.dwx, w.wy + anchorDelta.dwy);
    return { creep: m.id, to: { x, y, room } };
  });
}

// Greedy-assign each member to its nearest available slot tile and emit a move intent per member. Used
// for a reform (facing change) and for holding a broken block back together. Fewer members than slots (a
// degraded formation) leaves some slot tiles unfilled — the vacant slot needs nobody.
function reformOnto(members: readonly SnapCreep[], slots: readonly SlotTile[]): SquadMoveIntent[] {
  const room = slots[0]?.room ?? members[0]?.room ?? "";
  const memberRefs = members.map(m => ({ id: m.id, pos: { x: m.x, y: m.y } }));
  const assignment = reformAssignment(memberRefs, slots);
  return members.map(m => {
    const dest = assignment.get(m.id) ?? { x: m.x, y: m.y };
    return { creep: m.id, to: { x: dest.x, y: dest.y, room } };
  });
}

// Which slot index each member currently holds — greedy-nearest over slot tiles, returning indices so a
// straight advance can slide each member's own slot forward rather than reassigning it to another.
function assignMembersToSlotIndices(members: readonly SnapCreep[], slots: readonly SlotTile[]): Map<Id<Creep>, number> {
  const indexed = slots.map((s, i) => ({ i, pos: { x: s.x, y: s.y } }));
  const memberRefs = members.map(m => ({ id: m.id, pos: { x: m.x, y: m.y } }));
  // Reuse the greedy matcher over the slot POSITIONS, then map the chosen position back to its index.
  const assignment = reformAssignment(memberRefs, indexed.map(s => s.pos));
  const byMember = new Map<Id<Creep>, number>();
  for (const m of members) {
    const pos = assignment.get(m.id);
    if (!pos) continue;
    const slot = indexed.find(s => s.pos.x === pos.x && s.pos.y === pos.y);
    if (slot) byMember.set(m.id, slot.i);
  }
  return byMember;
}

/** Generic action dispatch: hand the shared state to a squad type's own planner and return its map
 * unchanged. `Squad` never interprets an ActionIntent's `do`/`target` — the whole point of the split. */
export function planSquadActions(
  state: SquadState,
  colony: import("../snapshot/types").ColonySnapshot,
  planner: SquadActionPlanner
): Map<Id<Creep>, ActionIntent> {
  return planner(state, colony);
}
