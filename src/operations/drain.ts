// Drain Energy (issue #34/ADR 0006, movement redesigned per issue #41/ADR 0007): one fixed 4-creep squad
// (1 drainAttacker + 3 drainHealer) sent at a single target room (ColonyMemory.draining, snapshot.draining
// — a scalar, unlike Attack's `attacking` list, because exactly one drain target per colony is load-bearing
// for squad membership being derived from `op` alone, no squadId — see ADR 0006). Squad membership is every
// creep sharing this operation's `op` stamp (Operation.owned()), same pattern Attack/Defense use.
//
// Movement is NO LONGER hand-rolled here as per-creep squadTargetPos + independent Traveler convergence
// (that drifted apart over distance — see docs/drain-squad-handoff.md). Drain now defines its Formation and
// action content and hands a SquadState to the generic Squad entity (src/lib/squad.ts), which computes ONE
// route for the whole footprint and one lockstep move per member (empire/creeps.ts's runSquads). Drain's
// own tactical decisions — staging-room pick, advance/retreat safety projection, tower-damage sampling —
// are UNCHANGED (ADR 0007's out-of-scope): only the movement EXECUTION mechanism they drive is replaced.

import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import { incomingHeal, towerDamageAt, type HealSource } from "../lib/combat";
import { slotTiles, type Formation } from "../lib/formation";
import { range, type XY } from "../lib/geometry";
import { log } from "../lib/log";
import { inFormation, type ActionIntent, type SquadActionPlanner, type SquadState } from "../lib/squad";
import type { TerrainSource } from "../lib/squadPath";
import type { ColonySnapshot, SnapCreep, SnapTower } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

const DRAIN_HEALER_COUNT = 3;
const DRAIN_SQUAD_SIZE = 1 + DRAIN_HEALER_COUNT;

// Drain's formation as data (ADR 0007): the attacker is the anchor slot at (0,0), the three healers fill
// the other three tiles of a strict 2x2 block trailing right/down of the anchor at the canonical TOP
// facing. A strict 2x2 requires mutual range-1 (heal-assist reach), which only holds at the 4 axis-aligned
// facings — Drain's own facing-selection (drainFacing below) collapses the 8 travel directions onto those
// 4, keeping that constraint in Drain's content rather than in the generic rotation math.
export const DRAIN_FORMATION: Formation = [
  { dx: 0, dy: 0, role: "drainAttacker" },
  { dx: 1, dy: 0, role: "drainHealer" },
  { dx: 0, dy: 1, role: "drainHealer" },
  { dx: 1, dy: 1, role: "drainHealer" }
];

/** The first room along `route` (home -> target, see ColonySnapshot.drainRoute) where ScoutInfo.hostile
 * is false — an unscouted room defaults to `hostile: false` at the snapshot boundary already, so this
 * function itself doesn't need to special-case "never scouted" separately (ADR 0006's staging-room rule).
 * Undefined when the route is empty or every room on it is hostile — Drain then has nowhere safe to
 * rendezvous the squad and holds everything at home. Pure: takes plain data, no Game access. */
export function pickStagingRoom(route: readonly { room: string; hostile: boolean }[]): string | undefined {
  return route.find(r => !r.hostile)?.room;
}

/** The axis-aligned facing (TOP/RIGHT/BOTTOM/LEFT) nearest the travel direction from `from` toward `to`.
 * A strict 2x2 only has these 4 valid orientations (its diagonals splay the block past range 1 — see
 * DRAIN_FORMATION), so Drain collapses the compass onto them here rather than the generic slotTiles doing
 * so. Ties (a perfect diagonal) resolve toward the dominant-or-vertical axis, deterministically. */
function drainFacing(from: XY, to: XY): DirectionConstant {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? RIGHT : LEFT;
  if (Math.abs(dy) > 0) return dy > 0 ? BOTTOM : TOP;
  return TOP; // no movement — hold the canonical facing
}

const AXIS_FACINGS: DirectionConstant[] = [TOP, RIGHT, BOTTOM, LEFT];

/** The facing the squad's LIVE positions already sit tight at, if any — checked BEFORE trusting the
 * goal-directed drainFacing. Without this, squadState() recomputed facing fresh every tick purely from
 * travel direction, with no regard for what facing the squad's actual current shape corresponds to: a
 * squad that settled into a tight TOP-facing block (e.g. after a reform driven by whatever positions
 * stragglers happened to converge from) but whose goal now lies roughly west would be stamped facing=LEFT
 * every tick regardless — inFormation() (checked against that STATED facing) then reports "not tight"
 * forever, since the block's real shape is TOP's, not LEFT's, even though it never moves and IS tight.
 * Confirmed live: a squad stuck reporting reform@nearestFit onto its own already-occupied tiles, tick after
 * tick, because the stated facing didn't match reality. Trying the 4 axis-aligned facings (the only ones
 * DRAIN_FORMATION's strict 2x2 needs — see drainFacing) against the LIVE anchor is enough: if one fits, the
 * squad reports that as `facing` so inFormation can actually recognize it, and findSquadPath's own
 * reform-edge search is what plans the (stationary) turn toward the goal-directed facing afterward — that
 * mechanism already exists, it just never got a chance to run while squadState kept overwriting "current"
 * with "desired" outright. */
function currentFacing(anchor: XY & { room: string }, members: readonly SnapCreep[], formation: Formation): DirectionConstant | undefined {
  for (const facing of AXIS_FACINGS) {
    if (inFormation(members, slotTiles(anchor, facing, formation))) return facing;
  }
  return undefined;
}

/** Projected tower damage against the squad's current heal output, at candidate anchor position `nextPos`
 * — the ADR 0006 continuous advance/retreat rule: every tower currently visible in the target room summed
 * at its own distance, versus what the squad can heal through (incomingHeal, fed every alive healer as a
 * HealSource — approximated at the anchor's next tile, since the block is a rigid range-1 body). Advance is
 * safe exactly when heal output at least matches projected damage; no towers visible reads as safe. */
function advanceIsSafe(nextPos: XY, towers: readonly SnapTower[], healers: readonly HealSource[]): boolean {
  if (towers.length === 0) return true;
  const projectedDamage = towers.reduce((sum, t) => sum + towerDamageAt(range(t, nextPos)), 0);
  return projectedDamage <= incomingHeal(nextPos, healers);
}

// A healer's live HEAL part count (unboosted — SnapCreep carries no per-part boost data; a gap worth
// revisiting if boost support is added to SnapCreep).
function healPartsOf(creep: SnapCreep): number {
  return creep.body.filter(p => p === HEAL).length;
}

export class Drain extends Operation {
  public readonly kind = "drain";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    if (!colony.draining) return [];
    return [
      ...this.fillSquadRole(colony, "drainAttacker", 1),
      ...this.fillSquadRole(colony, "drainHealer", DRAIN_HEALER_COUNT)
    ];
  }

  /** One role's deficit toward the fixed composition, pinned to the HOME colony (see fillRole). */
  private fillSquadRole(colony: ColonySnapshot, role: "drainAttacker" | "drainHealer", wanted: number): CreepRequest[] {
    const owned = this.owned(colony, role).length;
    const missing = wanted - owned;
    if (missing <= 0) return [];
    const body = orderBody(roleDef(role)?.body(colony.energyCapacity, { hasContainer: false, hasLink: false }) ?? []);
    if (body.length === 0) return [];
    return Array.from({ length: missing }, () => ({
      body,
      priority: roleDef(role)!.priority,
      memory: { role, home: colony.name, op: this.name },
      targetRoom: colony.name,
      spawnRoom: colony.name
    }));
  }

  /** Every live squad member, attacker first when present. */
  private squad(colony: ColonySnapshot): SnapCreep[] {
    return [...this.owned(colony, "drainAttacker"), ...this.owned(colony, "drainHealer")];
  }

  /** The squad's terrain source — drainRoomTerrain covers `draining` and every drainRoute room, cached
   * vision-independently at the snapshot boundary. A room with no entry reads as fully walkable (the same
   * fail-open convention Drain has always used for a snapshot gap). */
  public terrain(colony: ColonySnapshot): TerrainSource {
    return room => colony.drainRoomTerrain[room];
  }

  /** Where the squad is heading this tick, for the generic Squad's route search — the same advance/retreat
   * aim goalTile computes, resolved against the current live squad. Undefined while there's no squad to
   * move (assembling, or no target). */
  public squadGoal(colony: ColonySnapshot): (XY & { room: string }) | undefined {
    if (!colony.draining) return undefined;
    const staging = pickStagingRoom(colony.drainRoute);
    if (!staging) return undefined;
    const squad = this.squad(colony);
    if (squad.length === 0) return undefined;
    return this.goalTile(colony, squad, staging);
  }

  /** The anchor slot's tile this tick, derived fresh from the live squad (no persisted state, matching
   * ADR 0006's recompute-every-tick rule). The attacker IS the anchor slot, so its tile is the anchor when
   * it's alive. With the attacker dead (a degraded formation retreating as-is, ADR 0007), the anchor slot
   * is vacant but still the formation's reference point — inferred from a surviving healer minus its slot
   * offset so the block keeps a consistent anchor to reform/move around. Deterministic (first healer by
   * name) so two ticks with identical input agree. */
  private anchorTile(attacker: SnapCreep | undefined, healers: readonly SnapCreep[], facing: DirectionConstant, room: string): XY & { room: string } {
    if (attacker) return { x: attacker.x, y: attacker.y, room };
    // Attacker slot vacant: place the anchor so the first healer (deterministic) sits on its own slot tile.
    // Healer slots at the canonical facing are (1,0),(0,1),(1,1); the anchor is that healer's tile minus
    // its rotated offset. We use the first healer and the first healer slot for a stable reference.
    const healer = [...healers].sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!healer) return { x: 25, y: 25, room }; // no squad at all — a harmless default (never used)
    // The first healer slot offset (1,0) rotated to the current facing.
    const off = rotatedHealerOffset(facing);
    return { x: healer.x - off.dx, y: healer.y - off.dy, room };
  }

  /** The SquadState the generic Squad entity runs on this tick, or undefined while the squad is still
   * ASSEMBLING (rallying to staging via independent movement — that behaviour is unchanged, ADR 0007
   * requirement 2, and handled by the members' own step tables, NOT the squad machinery). Once assembled
   * and underway, returns a state whose members are only those SAME-ROOM as the current anchor — the
   * replacement re-entry gate (a freshly-spawned member still walking in runs its own step table until it
   * reaches the anchor's room, then joins; the squad never holds for it). */
  public squadState(colony: ColonySnapshot): SquadState | undefined {
    if (!colony.draining) return undefined;
    const staging = pickStagingRoom(colony.drainRoute);
    if (!staging) return undefined;

    const attacker = this.owned(colony, "drainAttacker")[0];
    const healers = this.owned(colony, "drainHealer");
    const squad = [...(attacker ? [attacker] : []), ...healers];
    if (squad.length === 0) return undefined;

    const assembled = attacker !== undefined && healers.length >= DRAIN_HEALER_COUNT && squad.length >= DRAIN_SQUAD_SIZE;
    // Ready for the first push: fully assembled AND every member physically together in the staging room.
    const readyForFirstPush = assembled && squad.every(c => c.room === staging);
    // Already committed to the field: some member stands in a room BEYOND the staging room on the route
    // toward the target (staging's successors, including the target room itself). This keeps a degraded
    // squad in squad-movement mode after losses (3 healers in the target room are still "underway") while
    // excluding both a squad still trickling out from home and one still en route TO staging (a room before
    // staging on the route — e.g. a transit room — is not yet underway).
    const beyondStaging = roomsBeyondStaging(colony.drainRoute, staging);
    const underway = squad.some(c => beyondStaging.has(c.room));

    // Still assembling — not a full squad physically together in staging, and not yet committed past it.
    // No squad machinery: members rally independently via their own step tables (ADR 0007 requirement 2).
    if (!readyForFirstPush && !underway) return undefined;

    // The formation's anchor room: whichever room the squad's members are actually standing in (the mode
    // room). Before the first push, that's the staging room.
    const anchorRoom = readyForFirstPush ? staging : mostCommonRoom(squad);
    const goal = this.goalTile(colony, squad, staging);
    const desiredFacing = drainFacing(anchorReference(squad, anchorRoom), goal);
    const anchor = this.anchorTile(attacker, healers, desiredFacing, anchorRoom);
    // Replacement re-entry gate: only members in the anchor's room are squadded; a member elsewhere (a
    // spawned replacement still walking in) is left to its own step table this tick.
    const members = squad.filter(c => c.room === anchor.room);
    // Report whichever facing the squad's LIVE positions already sit tight at, if any — NOT unconditionally
    // the goal-directed one. A tight block whose real shape doesn't match desiredFacing (settled from
    // wherever stragglers converged, not necessarily facing the goal) would otherwise be stamped a facing
    // it never actually holds, so inFormation() (checked against the STATED facing) reports "not tight"
    // forever even though the squad is genuinely welded — confirmed live (a squad frozen "reforming" onto
    // tiles it already occupied, every tick, because the reported facing didn't match its real shape).
    // findSquadPath's own reform-edge search handles turning toward desiredFacing once this reports the
    // squad's true current facing — that mechanism only needed a correct starting point to run at all.
    const facing = currentFacing(anchor, members, DRAIN_FORMATION) ?? desiredFacing;
    log.debugRoom(
      colony.name,
      `drain squadState: readyForFirstPush=${readyForFirstPush} underway=${underway} anchorRoom=${anchorRoom} ` +
        `anchor=(${anchor.x},${anchor.y},${anchor.room}) facing=${facing} desiredFacing=${desiredFacing} goal=(${goal.x},${goal.y},${goal.room}) ` +
        `squad=[${squad.map(c => `${c.name}@${c.room}(${c.x},${c.y})`).join(",")}] members=[${members.map(c => c.name).join(",")}]`
    );
    if (members.length === 0) return undefined;
    return { members, formation: DRAIN_FORMATION, anchor, facing };
  }

  /** Where the squad is heading this tick — deeper into the target room when advancing is safe (and the
   * squad is fully healed), else back toward the staging room. Same continuous advance/retreat rule as
   * ADR 0006, only the execution changed: the aim is a room-center that findSquadPath paths the whole
   * footprint toward, rather than a per-creep travelTo target. */
  public goalTile(colony: ColonySnapshot, squad: readonly SnapCreep[], staging: string): XY & { room: string } {
    const attacker = squad.find(c => c.role === "drainAttacker");
    const healers = squad.filter(c => c.role === "drainHealer");
    const anchorPos = attacker ?? squad[0];
    const towers = colony.draining ? (colony.hostileRoomTowers[colony.draining] ?? []) : [];
    const healSources: HealSource[] = healers.map(h => ({ x: h.x, y: h.y, healParts: healPartsOf(h) }));
    // Advance only when every member is at full HP (a hurt squad falls back to heal up — never gated on
    // retreat) AND the next tile's projected tower damage is survivable.
    const fullyHealed = squad.every(c => c.hits >= c.hitsMax);
    const target = colony.draining ?? staging;
    const advanceAim: XY & { room: string } = { x: 25, y: 25, room: target };
    const retreatAim: XY & { room: string } = { x: 25, y: 25, room: staging };
    // Project one tile toward the advance aim from the anchor's current tile (see ADR 0006 — a far room
    // center must not be pre-emptively rejected by towers near a border the squad hasn't reached).
    const nextStep: XY = anchorPos
      ? { x: anchorPos.x + Math.sign(advanceAim.x - anchorPos.x), y: anchorPos.y + Math.sign(advanceAim.y - anchorPos.y) }
      : { x: 25, y: 25 };
    const safe = fullyHealed && advanceIsSafe(nextStep, towers, healSources);
    log.debugRoom(
      colony.name,
      `drain goalTile: fullyHealed=${fullyHealed} safe=${safe} nextStep=(${nextStep.x},${nextStep.y}) ` +
        `towers=${towers.length} aim=${safe ? "advance" : "retreat"}(${(safe ? advanceAim : retreatAim).room})`
    );
    return safe ? advanceAim : retreatAim;
  }

  /** Drain's own action content, plugged into the generic Squad (which knows nothing of towers/healing):
   * the attacker targets a tower first then the most threatening hostile; each healer targets the most
   * damaged squad-mate. Squad-level, computed once per tick from the shared state (ADR 0007) — not each
   * creep re-resolving its own target. */
  public readonly actionPlanner: SquadActionPlanner = (state, colony) => planDrainActions(state, colony);

  public override intents(colony: ColonySnapshot): Intent[] {
    if (!colony.draining) return [];
    const staging = pickStagingRoom(colony.drainRoute);
    if (!staging) return [];

    const squad = this.squad(colony);
    const state = this.squadState(colony);
    const out: Intent[] = [];

    // Steer every UNSQUADDED member (not in the current squad state's member set — assembling, or a
    // replacement still walking in) toward a concrete TILE, not just a room: the squad's live anchor once
    // one exists (a replacement/straggler closing distance onto the actual moving formation), else the
    // staging room's center pre-assembly. Squadded members are driven by runSquads, not the step table, so
    // they ignore this. A room-name-only destination (the old attackTargetRoom + moveToRoom pairing) let
    // two stragglers each converging on "whichever room the OTHER one currently stands in" chase each other
    // back and forth across a border forever, since each one's destination flipped the instant its target
    // crossed — confirmed live. drainRallyPos + moveToPos target a real point instead.
    const squaddedIds = new Set(state?.members.map(m => m.id));
    const rallyPos: XY & { room: string } = state ? state.anchor : { x: 25, y: 25, room: staging };
    for (const c of squad) {
      if (squaddedIds.has(c.id)) continue;
      const current = c.memory.drainRallyPos;
      if (!current || current.x !== rallyPos.x || current.y !== rallyPos.y || current.room !== rallyPos.room) {
        out.push({ kind: "setDrainRallyPos", creep: c.id, pos: rallyPos });
      }
    }

    out.push(...this.drainSample(colony));
    return out;
  }

  /** #40/ADR 0006's operation-owned observation history — a {tick, towerEnergy, storageEnergy} sample
   * whenever the target room has vision this tick (visibleRooms is the authoritative vision signal). */
  private drainSample(colony: ColonySnapshot): Intent[] {
    const target = colony.draining;
    if (!target) return [];
    if (!colony.visibleRooms.some(r => r.room === target)) return [];
    const towerEnergy = (colony.hostileRoomTowers[target] ?? []).reduce((sum, t) => sum + t.storeEnergy, 0);
    const storageEnergy = colony.hostileRoomStorageEnergy[target] ?? 0;
    log.debugRoom(colony.name, `drain: sample ${target} tick=${colony.tick} towerEnergy=${towerEnergy} storageEnergy=${storageEnergy}`);
    return [{ kind: "recordDrainSample", room: colony.name, target, tick: colony.tick, towerEnergy, storageEnergy }];
  }
}

// The first healer slot offset (1,0 at the canonical TOP facing) rotated to the current facing — used to
// back out the anchor tile from a surviving healer when the attacker (anchor slot) is dead.
function rotatedHealerOffset(facing: DirectionConstant): { dx: number; dy: number } {
  // (1,0) rotated: RIGHT -> (0,1), BOTTOM -> (-1,0), LEFT -> (0,-1), TOP -> (1,0).
  switch (facing) {
    case RIGHT:
      return { dx: 0, dy: 1 };
    case BOTTOM:
      return { dx: -1, dy: 0 };
    case LEFT:
      return { dx: 0, dy: -1 };
    default:
      return { dx: 1, dy: 0 };
  }
}

// The set of rooms on the route that lie BEYOND the staging room toward the target (staging's successors,
// target included) — "underway" territory. A room before staging (a transit room the squad is still
// walking through to reach staging) is not in this set.
function roomsBeyondStaging(route: readonly { room: string }[], staging: string): Set<string> {
  const idx = route.findIndex(r => r.room === staging);
  if (idx < 0) return new Set();
  return new Set(route.slice(idx + 1).map(r => r.room));
}

// The tile the facing is measured FROM — the attacker's tile when present, else the first squad member's.
function anchorReference(squad: readonly SnapCreep[], room: string): XY {
  const attacker = squad.find(c => c.role === "drainAttacker" && c.room === room);
  const ref = attacker ?? squad.find(c => c.room === room) ?? squad[0];
  return { x: ref?.x ?? 25, y: ref?.y ?? 25 };
}

// The room most of the squad's members currently stand in — the formation's anchor room while underway.
function mostCommonRoom(squad: readonly SnapCreep[]): string {
  const counts = new Map<string, number>();
  for (const c of squad) counts.set(c.room, (counts.get(c.room) ?? 0) + 1);
  let best = squad[0]?.room ?? "";
  let bestN = -1;
  for (const [room, n] of counts) if (n > bestN) [best, bestN] = [room, n];
  return best;
}

/** Drain's plugged-in action planner (ADR 0007): attacker targets a tower first (the namesake energy
 * drain), falling back to the most threatening hostile; each healer targets the most damaged squad-mate
 * (including itself). Pure — reads only the shared state and the colony snapshot, no Game. Only emits an
 * action for a member that actually has a target this tick (no target -> no entry). */
export function planDrainActions(state: SquadState, colony: ColonySnapshot): Map<Id<Creep>, ActionIntent> {
  const out = new Map<Id<Creep>, ActionIntent>();
  const anchorRoom = state.anchor.room;
  const towers = colony.draining === anchorRoom ? (colony.hostileRoomTowers[anchorRoom] ?? []) : [];
  // Snapshot carries only the home room's hostile creeps (colony.hostiles); the target room's are not
  // generally available, so the attacker's hostile fallback is best-effort — its primary target, the
  // tower (the operation's namesake energy drain), always comes from hostileRoomTowers above.
  const hostiles = colony.hostiles;

  for (const member of state.members) {
    if (member.role === "drainAttacker") {
      const tower = towers[0];
      if (tower) {
        out.set(member.id, { do: "attack", target: tower.id });
        continue;
      }
      const hostile = mostThreatening(hostiles);
      if (hostile) out.set(member.id, { do: "attack", target: hostile.id });
    } else {
      // Healer: most damaged squad-mate (lowest hits fraction), including self.
      const patient = mostDamaged(state.members);
      if (patient) out.set(member.id, { do: "heal", target: patient.id });
    }
  }
  return out;
}

// Lowest hits/hitsMax fraction — the heal target. Ties resolve to the first encountered (deterministic
// given a stable member order).
function mostDamaged(members: readonly SnapCreep[]): SnapCreep | undefined {
  let best: SnapCreep | undefined;
  let bestFrac = Infinity;
  for (const m of members) {
    const frac = m.hitsMax > 0 ? m.hits / m.hitsMax : 1;
    if (frac < bestFrac) {
      best = m;
      bestFrac = frac;
    }
  }
  return best;
}

// The most threatening hostile by body composition (attacker > healer > unarmed), nearest as tiebreaker —
// mirrors the "mostThreatening" prefer used by the old step table's hostile fallback.
function mostThreatening(hostiles: readonly { id: Id<Creep>; attackParts: number; rangedAttackParts: number; healParts: number }[]):
  | { id: Id<Creep> }
  | undefined {
  let best: { id: Id<Creep>; score: number } | undefined;
  for (const h of hostiles) {
    const score = (h.attackParts + h.rangedAttackParts) * 2 + h.healParts;
    if (!best || score > best.score) best = { id: h.id, score };
  }
  return best;
}
