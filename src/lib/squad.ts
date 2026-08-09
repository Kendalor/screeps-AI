// The Squad entity's pure planning core (ADR 0007). A squad computes ONE plan for the whole formation
// each tick — every member's move is dictated by the squad, so members cannot diverge from each other by
// construction (the mechanism fix replacing per-creep independent Traveler convergence). This module is
// GENERIC infrastructure: it knows only slots, members, anchors, and routing — nothing about
// towers, healing, or attackers. A squad "type" is a Formation plus a plugged-in planSquadActions
// function (Drain supplies its own), the same split RoleDef/Step draw between the generic step engine and
// each role's content. Pure: plain SquadState in, plain intents out, no Game access.

import { slotTiles, type Formation, type SlotTile } from "./formation";
import { range, type XY } from "./geometry";
import { findSquadPath, nearestFittingAnchor, NO_OCCUPANCY, type OccupancySource, type TerrainSource } from "./squadPath";
import type { SnapCreep } from "../snapshot/types";

// The squad's shared state for a tick — every member's position/HP/role, the formation shape, and the
// anchor's tile.
//
// `anchor` is the formation's bounding box's own FIXED top-left corner (formation.ts's
// assertSquareTopLeftAnchor requires every formation to be square with its anchor there) — a PERSISTED
// value owned by the calling operation (ColonyMemory.drainAnchor/paradeAnchor), never re-derived from any
// live creep's position. This is a deliberate departure from an earlier design (and from Overmind, the
// reference implementation) where the anchor was always whichever creep occupied the anchor SLOT's own live
// `.pos` — routing/placement should never care which creep sits where, only where the formation's box
// itself is. Only planSquadMove's own returned SquadMovePlan.anchor may advance this value going forward;
// the caller is responsible for persisting a changed anchor (see empire/creeps.ts's runSquads).
//
// There is no `facing` field: the box's tile-set (formation.ts's slotTiles) never rotates, so generic squad
// infrastructure has nothing to place "at a facing." Any preference for WHICH live member ends up on WHICH
// already-fixed tile (e.g. Drain's attacker-faces-threat requirement) is resolved entirely by the operation
// that wants it, composing reformAssignment itself — see operations/drain.ts — never a concern here.
//
// `members` may be FEWER than formation.length (a degraded formation with vacant slots — see ADR 0007).
export interface SquadState {
  members: SnapCreep[];
  formation: Formation;
  anchor: XY & { room: string };
}

// A resolved per-member move: the concrete tile this member should step toward this tick. Not a
// squadTargetPos for an independent Traveler to chase — the squad already decided every member's tile in
// lockstep, so a member's execution is a single move toward `to`, never its own pathfind.
export interface SquadMoveIntent {
  creep: Id<Creep>;
  to: XY & { room: string };
}

// planSquadMove's full result: the per-member moves AND the anchor value after this tick's plan. The anchor
// is returned (not just consumed internally) because it's now a PERSISTED value (see SquadState's doc) that
// this module — which has zero Game/Memory access by design — cannot write back itself; the caller compares
// `anchor` against the SquadState it passed in and, if different, persists the new value (empire/creeps.ts's
// runSquads). `anchor` equals the input state's anchor when holding/reforming in place, advances one step
// when the tight-advance branch fires, or is CORRECTED to a different fitting tile when a reform retargets
// (see planSquadMove's own doc for why a correction must be written through rather than discarded).
export interface SquadMovePlan {
  moves: SquadMoveIntent[];
  anchor: XY & { room: string };
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

/** The single most urgent threat, or undefined when `threats` is empty. Urgency is `range(from, threat) -
 * threat.engageRange` — how close the threat already is to actually landing a hit, NOT raw distance — so a
 * ranged attacker already at range 3 (urgency 0, hitting right now) outranks a melee attacker at range 4
 * (urgency 3, not yet hitting) even though the melee one is nearer in absolute tiles; a tower's Infinity
 * engageRange makes its urgency -Infinity whenever it's a candidate at all (a visible tower is always the
 * most urgent threat present). Ties keep the first-encountered threat (deterministic given a stable input
 * order) — a caller that cares about a specific tiebreak should pre-sort. Used by a squad type that wants
 * to bias WHICH member ends up on WHICH fixed slot tile toward a threat (e.g. Drain's attacker-faces-threat
 * — see operations/drain.ts) — this module has no notion of "facing" at all, only this raw urgency
 * comparison, which the caller composes with its own tile-preference/assignment logic. */
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

/** The one shared movement plan for the whole formation this tick. Returns every member's move intent PLUS
 * the anchor value after this tick's plan (SquadMovePlan — see its own doc for why the anchor must be
 * returned rather than just consumed internally: it's a persisted value this module cannot write itself).
 *
 * - When the block is NOT tight (a member off its slot, a straggler catching up, a replacement just
 *   joined), the anchor HOLDS and every member is assigned onto the current slot tiles (greedy
 *   nearest) so the block reforms — never advances while broken. UNLESS the squad's own current anchor can
 *   no longer fit the whole formation anywhere (some member shoved off, a stale persisted anchor from a
 *   long interruption, independent movement before joining walking it into a dead end) — reforming onto an
 *   unfittable target would hold forever, so the squad instead retargets the reform onto the NEAREST anchor
 *   that fits (nearestFittingAnchor). That retargeted anchor is returned as the plan's new `anchor` — a
 *   REAL correction, not just a movement retarget — because this anchor is no longer cheap to re-derive
 *   from a live creep next tick the way it used to be; if the caller doesn't persist the correction, the
 *   squad would silently drift from its own record of where its box is.
 * - When the block IS tight but a member is FATIGUED (creep.fatigue > 0 — swamp, an overweight body), the
 *   squad holds at its current slots rather than advancing: a fatigued creep's move() silently no-ops this
 *   tick, so committing the whole formation to slide forward would leave that one member behind while its
 *   squadmates still moved — reintroducing per-member drift under a different mechanism than the
 *   independent-Traveler convergence ADR 0007 replaced. Waits for every member's fatigue to clear before
 *   resuming the advance.
 * - When the block IS tight and unfatigued, the anchor advances one step along a footprint-fit route toward
 *   `goal` (findSquadPath, real PathFinder.search over a cached moving-maximum CostMatrix — see
 *   squadPath.ts/squadCostMatrix.ts — which checks the FULL formation shape regardless of occupancy), and
 *   every member is reassigned onto the NEXT step's slot tiles (slotTiles, re-derived fresh from the new
 *   anchor) — so the whole formation moves exactly one tile in lockstep. When no route exists (walled in) or
 *   the squad is already at the goal, it holds.
 *
 *   Pathing (findSquadPath/nearestFittingAnchor) and placement (slotTiles) are both given `state.formation`
 *   as-is, with no rotation anywhere: every formation is required to be a square with its anchor fixed at
 *   the box's own top-left corner (formation.ts's assertSquareTopLeftAnchor), so the footprint's tile-set
 *   relative to the anchor is simply fixed, full stop — there is no facing concept left to keep in sync
 *   between the two. (An earlier version of this function rotated the formation for pathing, then rotated it
 *   AGAIN independently for placement via a since-removed facing parameter — the two could disagree for any
 *   corner-anchored box, which placed a member on a tile pathing never actually verified; see git history on
 *   this comment and formation.ts's module header for the concrete reproduction.)
 *
 *   Each slot is placed FRESH via slotTiles(nextAnchor, formation) — a single-shot per-slot derivation from
 *   the new anchor, NOT a uniform world-coordinate delta applied independently across
 *   members (this module's earlier design). A uniform delta assumes the world-coordinate lattice always
 *   means "walkable neighbor," which the game does not guarantee at every room border (some rooms lack an
 *   exit on a given side, sector boundaries break uniform adjacency) — re-deriving each slot from the SAME
 *   single anchor, the way slotTiles already safely does for reform, closes that class of bug by construction
 *   rather than by convention.
 *
 * Walkability is ALWAYS checked against the full formation shape (via findSquadPath), even with vacant
 * slots — a shrunk fit-check could strand a later replacement (ADR 0007). `occupancy` (optional, defaults
 * to nothing occupied) is a sibling of `terrain` — see OccupancySource's doc in squadPath.ts — letting a
 * squad route around a live bystander creep or hostile structure exactly as it would a wall; the caller is
 * responsible for excluding the squad's OWN members' current tiles from it (this function has no notion of
 * "which creep is asking"). `now` is the caller's current tick, threaded through to the cached CostMatrix
 * (squadCostMatrix.ts) — a plain parameter rather than a direct Game.time read, matching this module's
 * existing no-Game-access convention. */
export function planSquadMove(
  state: SquadState,
  goal: XY & { room: string },
  terrain: TerrainSource,
  now: number,
  occupancy: OccupancySource = NO_OCCUPANCY
): SquadMovePlan {
  const currentSlots = slotTiles(state.anchor, state.formation);

  // Not a tight block: hold and reform — but only onto a target the full formation can actually occupy.
  if (!inFormation(state.members, currentSlots)) {
    const fit = nearestFittingAnchor(state.anchor, state.formation, terrain, occupancy, now);
    const retargeted = fit !== undefined && (fit.x !== state.anchor.x || fit.y !== state.anchor.y || fit.room !== state.anchor.room);
    const reformSlots = retargeted ? slotTiles(fit!, state.formation) : currentSlots;
    return { moves: reformOnto(state.members, reformSlots, terrain), anchor: retargeted ? fit! : state.anchor };
  }

  // Tight but a member can't actually move this tick — hold rather than advance without it.
  if (state.members.some(m => m.fatigue > 0)) {
    return { moves: reformOnto(state.members, currentSlots, terrain), anchor: state.anchor };
  }

  // Tight block: try to advance one footprint-fit step toward the goal.
  const path = findSquadPath(state.anchor, goal, state.formation, terrain, occupancy, now);
  const next = path && path.length > 1 ? path[1] : undefined;
  if (!next) {
    // Already at the goal, or no route the whole footprint can take — hold in place.
    return { moves: reformOnto(state.members, currentSlots, terrain), anchor: state.anchor };
  }

  // A straight advance: every member is reassigned onto the next anchor's slot tiles, re-derived fresh from
  // that anchor via slotTiles — see this function's own doc for why this replaced a uniform world-coordinate
  // delta slide. Matched to `currentSlots` BY INDEX (currentSlots[i] and nextSlots[i] are the SAME formation
  // slot, just shifted by the anchor's own movement), not via reformOnto's greedy nearest-distance search —
  // a diagonal advance step (real PathFinder.search routes diagonally with no cost penalty, unlike the old
  // bespoke A* this replaced) shifts the slot SET by one tile on BOTH axes, so a TRAILING member's old tile
  // can coincide with a DIFFERENT (nearer, but wrong) new slot, which a nearest-distance match would then
  // award it — e.g. a 2x2 advancing anchor (25,25)->(24,24): the attacker's own current tile (25,25) is
  // *closer* to the new trailing-corner slot (25,25) than to its own new slot (24,24), so nearest-distance
  // reform would leave the attacker in place and shuffle every OTHER member into a mirrored arrangement
  // instead of actually advancing — confirmed live via squadEvasion.test.ts's wall/bystander detours, which
  // route diagonally and never made progress under the old nearest-distance match. Since `inFormation` above
  // already confirmed every member sits on some `currentSlots[i]`, the index correspondence is unambiguous.
  const nextSlots = slotTiles(next.anchor, state.formation);
  return { moves: advanceOnto(state.members, currentSlots, nextSlots, terrain), anchor: next.anchor };
}

// Moves each member from its CURRENT slot to the slot at the SAME formation index in `nextSlots` — the
// advance-specific counterpart to reformOnto's role-blind nearest-distance match (see planSquadMove's
// advance-branch doc for why nearest-distance is wrong here specifically). Falls back to reformOnto's
// nearest-distance match for any member NOT found on one of `currentSlots` (shouldn't happen once
// `inFormation` has gated this branch, but keeps this function total rather than silently dropping a member).
function advanceOnto(members: readonly SnapCreep[], currentSlots: readonly SlotTile[], nextSlots: readonly SlotTile[], terrain?: TerrainSource): SquadMoveIntent[] {
  const room = nextSlots[0]?.room ?? members[0]?.room ?? "";
  const slotIndexOf = (m: SnapCreep): number => currentSlots.findIndex(s => s.room === m.room && s.x === m.x && s.y === m.y);
  const matched = new Map<Id<Creep>, XY>();
  const unmatched: SnapCreep[] = [];
  for (const m of members) {
    const idx = slotIndexOf(m);
    if (idx >= 0 && nextSlots[idx]) matched.set(m.id, { x: nextSlots[idx].x, y: nextSlots[idx].y });
    else unmatched.push(m);
  }
  if (unmatched.length > 0) {
    const takenIdxs = new Set(members.filter(m => matched.has(m.id)).map(m => slotIndexOf(m)));
    const freeSlots = nextSlots.filter((_, i) => !takenIdxs.has(i));
    const memberRefs = unmatched.map(m => ({ id: m.id, pos: { x: m.x, y: m.y } }));
    const fallback = reformAssignment(memberRefs, freeSlots);
    for (const [id, pos] of fallback) matched.set(id, pos);
  }
  const repaired = terrain ? slotChainRepair(members, nextSlots, matched, terrain) : matched;
  return members.map(m => {
    const dest = repaired.get(m.id) ?? { x: m.x, y: m.y };
    return { creep: m.id, to: { x: dest.x, y: dest.y, room } };
  });
}

// Greedy-assign each member to its nearest available slot tile and emit a move intent per member. Used
// for a reform and for holding a broken block back together. Fewer members than slots (a
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
//
// Exported so a squad type can compose it directly for a placement PREFERENCE this module deliberately
// stays ignorant of (e.g. Drain's attacker-faces-threat — operations/drain.ts's attackerBiasedMove calls
// this for every member EXCEPT the one it pre-assigned itself) — this does not make reformOnto role-aware
// itself; it's still the same role-blind nearest-distance match called twice by the caller, once for a
// pre-seeded member/slot and once for the rest, rather than lib/squad.ts gaining any notion of "attacker."
export function reformOnto(members: readonly SnapCreep[], slots: readonly SlotTile[], terrain?: TerrainSource): SquadMoveIntent[] {
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

/** Generic action dispatch: hand the shared state to a squad type's own planner and return its map
 * unchanged. `Squad` never interprets an ActionIntent's `do`/`target` — the whole point of the split. */
export function planSquadActions(
  state: SquadState,
  colony: import("../snapshot/types").ColonySnapshot,
  planner: SquadActionPlanner
): Map<Id<Creep>, ActionIntent> {
  return planner(state, colony);
}
