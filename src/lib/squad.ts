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

// A hostile (or hostile structure) the formation might need to orient toward — reduced to just what facing
// selection needs: a position and how close it must get before it's actually hitting the squad. Melee
// engages at range 1, ranged at range 3, a tower effectively always (it's already in range the instant it
// has vision of the squad) — callers derive this from SnapUnit/SnapTower via their own attackParts/
// rangedAttackParts/structureType, not this module's concern (GENERIC infrastructure, see module header).
export interface Threat extends XY {
  engageRange: number; // Infinity for an always-in-range threat (a tower)
}

// The 8 compass directions in CW_STEPS order (formation.ts) — TOP first, then clockwise. Facing selection
// below picks among these the same way rotateOffset's canonical ordering does, so a caller collapsing to a
// formation's own valid subset (e.g. Drain's 4 axis-aligned-only 2x2, see drainFacing in operations/
// drain.ts) can post-process this result exactly like it already does for goal-directed facing.
const COMPASS: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];

/** The single most urgent threat, or undefined when `threats` is empty. Urgency is `range(from, threat) -
 * threat.engageRange` — how close the threat already is to actually landing a hit, NOT raw distance — so a
 * ranged attacker already at range 3 (urgency 0, hitting right now) outranks a melee attacker at range 4
 * (urgency 3, not yet hitting) even though the melee one is nearer in absolute tiles; a tower's Infinity
 * engageRange makes its urgency -Infinity whenever it's a candidate at all (a visible tower is always the
 * most urgent threat present). Ties keep the first-encountered threat (deterministic given a stable input
 * order) — a caller that cares about a specific tiebreak should pre-sort. Exported separately from
 * threatFacing (which calls this) so a caller collapsing to a formation-specific facing subset (e.g.
 * Drain's 4 axis-aligned-only 2x2, drainFacing in operations/drain.ts) can run ITS OWN direction collapse
 * against the same winning threat's position, rather than duplicating the urgency comparison. */
export function mostUrgentThreat(from: XY, threats: readonly Threat[]): Threat | undefined {
  let worst: Threat | undefined;
  let worstUrgency = Infinity;
  for (const t of threats) {
    const urgency = range(from, t) - t.engageRange;
    if (urgency < worstUrgency) {
      worst = t;
      worstUrgency = urgency;
    }
  }
  return worst;
}

/** The facing that turns the formation's canonical-TOP-facing "front" (dy < 0 side) most directly toward
 * the single most urgent threat (mostUrgentThreat), or undefined when there's nothing to face (no threats).
 *
 * `from` is the point urgency/direction are measured from (a squad's anchor, or whichever tile a caller
 * treats as its reference) — this function has no notion of "which slot is the front"; a formation
 * collapsing to axis-aligned-only facings (see COMPASS's doc) applies that constraint itself afterward,
 * same as it already does for goal-directed facing. Pure: no Game access, no formation/slot knowledge. */
export function threatFacing(from: XY, threats: readonly Threat[]): DirectionConstant | undefined {
  const worst = mostUrgentThreat(from, threats);
  if (!worst) return undefined;
  const dx = worst.x - from.x;
  const dy = worst.y - from.y;
  if (dx === 0 && dy === 0) return TOP; // threat is co-located — no meaningful direction, hold canonical
  // The compass direction nearest the (dx, dy) vector's angle — atan2's 0 is along +x (RIGHT), and screeps'
  // y grows downward same as atan2's convention here, so no axis flip is needed before mapping onto the
  // 8-way compass (COMPASS[0] = TOP = -90 degrees from +x, hence the +2 step offset below).
  const angle = Math.atan2(dy, dx); // -PI..PI, 0 = RIGHT, PI/2 = BOTTOM (y-down)
  const step = Math.round(angle / (Math.PI / 4)) + 2; // shift so index 0 lands on TOP
  const idx = ((step % 8) + 8) % 8;
  return COMPASS[idx];
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
    // Prefer the CALLER's stated facing (state.facing — e.g. threatFacing/drainFacing's output) when the
    // current anchor also fits there, rather than nearestFittingAnchor's own facing-order tiebreak (see its
    // doc) redirecting a reforming squad to an unrelated facing just because that happened to be scanned
    // first on open terrain.
    const fit = nearestFittingAnchor(state.anchor, state.formation, terrain, occupancy, state.facing);
    const reformSlots =
      fit && (fit.anchor.x !== state.anchor.x || fit.anchor.y !== state.anchor.y || fit.facing !== state.facing)
        ? slotTiles(fit.anchor, fit.facing, state.formation)
        : currentSlots;
    return reformOnto(state.members, reformSlots, terrain);
  }

  // Tight but a member can't actually move this tick — hold rather than advance without it.
  if (state.members.some(m => m.fatigue > 0)) {
    return reformOnto(state.members, currentSlots, terrain);
  }

  // Tight block: try to advance/reform one footprint-fit step toward the goal.
  const path = findSquadPath({ anchor: state.anchor, facing: state.facing }, goal, state.formation, terrain, occupancy);
  const next = path && path.length > 1 ? path[1] : undefined;
  if (!next) {
    // Already at the goal, or no route the whole footprint can take — hold in place.
    return reformOnto(state.members, currentSlots, terrain);
  }

  const facingChanged = next.facing !== state.facing;
  if (facingChanged) {
    // A reform step: the anchor holds, the facing changes. Greedy-reassign members to the new-facing slot
    // tiles — the multi-tick reshape / one-tick symmetric turn, same mechanism.
    const nextSlots = slotTiles(next.anchor, next.facing, state.formation);
    return reformOnto(state.members, nextSlots, terrain);
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
// degraded formation) leaves some slot tiles unfilled — the vacant slot needs nobody. The initial match is
// role-BLIND, same as it always was (a healer standing on a dead attacker's vacant slot is harmless — the
// formation only cares that every LIVE member sits on SOME slot, not which one — and role-restricting this
// step regressed a degraded-formation test: forcing 3 survivors onto exactly their own 3 same-role slots
// while leaving the attacker slot artificially vacant offset the block from nearestFittingAnchor's search
// origin, making it drift indefinitely on open terrain instead of settling).
//
// When terrain is supplied, reachability-repairing: the plain nearest-distance match can still park a
// member on the ONE tile that is the sole physical approach to another member's assigned slot — confirmed
// live (2026-08-07, colony W8N3's drain squad: a straggler healer permanently stalled one tile short of its
// slot because the only doorway through a narrow corridor was occupied by an already-"arrived" healer
// sitting on ITS OWN nearest slot, which never got reassigned since distance-0 self-matches always win the
// greedy race first). Fixed by finding a same-role PATH THROUGH THE FORMATION'S OWN SLOT GRAPH from the
// blocker's slot to the stranded member's slot, then shifting every member along that path one slot toward
// the stranded member — the blocker steps into the (now-nearer, directly reachable) stranded member's slot,
// vacating its own, exactly like people filing forward through a doorway (see slotChainRepair's doc for the
// full mechanism). Falls back to the naive assignment unchanged if no such chain exists (never worse than
// the pre-fix behavior).
function reformOnto(members: readonly SnapCreep[], slots: readonly SlotTile[], terrain?: TerrainSource): SquadMoveIntent[] {
  const room = slots[0]?.room ?? members[0]?.room ?? "";
  const memberRefs = members.map(m => ({ id: m.id, pos: { x: m.x, y: m.y } }));
  const assignment = reformAssignment(memberRefs, slots);
  const repaired = terrain ? slotChainRepair(members, slots, assignment, terrain) : assignment;
  return members.map(m => {
    const dest = repaired.get(m.id) ?? { x: m.x, y: m.y };
    return { creep: m.id, to: { x: dest.x, y: dest.y, room } };
  });
}

// Two slots are adjacent in the formation's own slot graph iff a creep on one could step directly onto the
// other (Chebyshev range 1) — the formation is always a handful of tiles across (ADR 0007), so this graph
// has at most a handful of nodes and is trivial to search in full, no budget/cap needed anywhere.
function adjacentSlots(a: XY, b: XY): boolean {
  return range(a, b) === 1;
}

// Whether `tile` is walkable per terrain alone (no occupancy — used only to keep a chain step off a literal
// wall; squadmate occupancy is what the chain itself is resolving, not an obstacle to route around).
function isTerrainWalkable(tile: XY, room: string, terrain: TerrainSource): boolean {
  const t = terrain(room);
  return !t || t[tile.x * 50 + tile.y] === 1;
}

// Finds the shortest path (as a sequence of slot indices) through `slots`, restricted to slots whose role
// matches `role`, from `fromSlot` to `toSlot`, treating two slots as connected iff adjacentSlots. A plain
// BFS over the slot graph — bounded by construction to the formation's own slot count (single digits, ADR
// 0007), never room-scale, so no search budget is needed anywhere in this function. Returns undefined if no
// such path exists (a role's slots aren't mutually connected in this formation shape, or fromSlot/toSlot
// aren't both that role).
function slotPath(slots: readonly SlotTile[], role: string, fromIdx: number, toIdx: number): number[] | undefined {
  if (slots[fromIdx]?.role !== role || slots[toIdx]?.role !== role) return undefined;
  if (fromIdx === toIdx) return [fromIdx];
  const roleIdxs = slots.map((s, i) => (s.role === role ? i : -1)).filter(i => i >= 0);
  const cameFrom = new Map<number, number>();
  const seen = new Set<number>([fromIdx]);
  const queue = [fromIdx];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === toIdx) {
      const path = [toIdx];
      let n = toIdx;
      while (n !== fromIdx) {
        n = cameFrom.get(n)!;
        path.push(n);
      }
      return path.reverse();
    }
    for (const next of roleIdxs) {
      if (seen.has(next) || !adjacentSlots(slots[cur], slots[next])) continue;
      seen.add(next);
      cameFrom.set(next, cur);
      queue.push(next);
    }
  }
  return undefined;
}

// Repairs a naive nearest-slot assignment by shifting same-role members along a path through the
// FORMATION'S OWN SLOT GRAPH (not a general terrain search) — the fix for a member being stranded because a
// squadmate's CURRENT tile (typically its own already-assigned slot) sits between it and its assigned slot.
//
// For each member not currently standing adjacent-or-on its assigned slot, and whose direct approach is
// blocked by another squadmate's current tile: walk the same-role slot graph from the BLOCKING member's slot
// to the stranded member's slot (slotPath). Every member on that chain then shifts one slot toward the
// stranded member — the member on the slot nearest the stranded one moves into the stranded member's slot
// (freeing its own, which the stranded member can now approach directly), and so on down the chain. This is
// the formation-order shift: no pairwise swap search, no reachability BFS against terrain — the chain is
// read directly off the small, fixed slot graph the formation already defines, since a doorway jam only ever
// happens BETWEEN a formation's own slots (ADR 0007 — a squad's footprint is a handful of tiles across).
//
// A single pass is sufficient: aftershifting, every member on the chain sits on a slot whose approach is
// either the stranded member's old (now-unblocked) tile or another chain member's vacated slot — nothing
// left blocking anything else in the chain by construction.
function slotChainRepair(
  members: readonly SnapCreep[],
  slots: readonly SlotTile[],
  assignment: Map<Id<Creep>, XY>,
  terrain: TerrainSource
): Map<Id<Creep>, XY> {
  const current = new Map(assignment);
  const slotIdxOf = (pos: XY): number => slots.findIndex(s => s.x === pos.x && s.y === pos.y);
  const memberAt = (tile: XY, room: string): SnapCreep | undefined =>
    members.find(m => m.room === room && m.x === tile.x && m.y === tile.y);

  for (const member of members) {
    const dest = current.get(member.id);
    if (!dest) continue;
    if (member.x === dest.x && member.y === dest.y) continue; // already there
    if (adjacentSlots({ x: member.x, y: member.y }, dest)) continue; // directly approachable, nothing to repair

    // Is the member's approach blocked by a squadmate standing between it and its slot? The member isn't
    // adjacent to `dest` (checked above), so the ONLY way onto `dest` in a single formation-sized hop is via
    // one of `dest`'s own slot-graph neighbors — if every such neighbor is occupied by a squadmate parked on
    // ITS OWN slot (a fixed obstacle this tick, not one also mid-move), that neighbor is the blocker.
    const destSlotIdx = slotIdxOf(dest);
    if (destSlotIdx < 0) continue;
    const role = slots[destSlotIdx].role;

    const candidateBlockerSlots = slots
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => s.role === role && i !== destSlotIdx && adjacentSlots(dest, s));

    for (const { s: blockerSlot, i: blockerIdx } of candidateBlockerSlots) {
      const blocker = memberAt(blockerSlot, blockerSlot.room);
      if (!blocker || blocker.id === member.id) continue;
      // The blocker must actually be sitting on ITS OWN assigned slot (not mid-repair itself, not a member
      // whose own destination differs — that member is still moving this tick and isn't a fixed obstacle).
      const blockerDest = current.get(blocker.id);
      if (!blockerDest || blockerDest.x !== blockerSlot.x || blockerDest.y !== blockerSlot.y) continue;

      // chain runs from the blocker's slot (chain[0]) to the stranded member's original destination
      // (chain[end], the vacant slot). A SHIFT, not a swap: every member currently on chain[k] moves UP the
      // chain to chain[k+1] (one step nearer the vacant end) — the blocker itself (chain[0]'s occupant)
      // moves to chain[1], the occupant of chain[1] (if any) moves to chain[2], and so on, all the way to
      // chain[end] which was vacant and receives whichever member sat on chain[end-1]. The member that was
      // stranded is REDIRECTED onto chain[0] (the blocker's old slot), now vacated and directly approachable
      // — NOT onto its original far destination chain[end], which is why this differs from a plain two-party
      // swap (that would leave the blocker outside the formation, still needing its own repair next tick).
      // Walk from the NEAR end of the chain outward so each write happens before the slot it reads is
      // overwritten by an earlier iteration.
      const chain = slotPath(slots, role, blockerIdx, destSlotIdx);
      if (!chain || chain.length < 2) continue;

      let ok = true;
      for (let k = 0; k < chain.length; k++) {
        const toSlot = slots[chain[k]];
        if (!isTerrainWalkable(toSlot, toSlot.room, terrain)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      for (let k = 0; k < chain.length - 1; k++) {
        const occupantId = memberAt(slots[chain[k]], slots[chain[k]].room)?.id;
        if (!occupantId) continue;
        const targetSlot = slots[chain[k + 1]];
        current.set(occupantId, { x: targetSlot.x, y: targetSlot.y });
      }
      const freedSlot = slots[chain[0]];
      current.set(member.id, { x: freedSlot.x, y: freedSlot.y });
      break; // one repair per member per call is enough — reformOnto is re-run every tick
    }
  }
  return current;
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
