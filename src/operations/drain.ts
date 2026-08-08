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
import { range, worldOf, type XY } from "../lib/geometry";
import { log } from "../lib/log";
import { inFormation, mostUrgentThreat, type ActionIntent, type SquadActionPlanner, type SquadState, type Threat } from "../lib/squad";
import type { OccupancySource, TerrainSource } from "../lib/squadPath";
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

// A melee hostile's engage range (adjacent) vs. a ranged one's (RANGED_ATTACK's max range) — a mixed body
// (both part types) is classified melee since that's the tighter, more urgent range: it can still land a
// melee hit the instant it's adjacent regardless of also carrying RANGED_ATTACK parts.
const MELEE_ENGAGE_RANGE = 1;
const RANGED_ENGAGE_RANGE = 3;

/** The visible hostile creeps and towers in `room` as generic Threat entries for threatFacing/
 * mostUrgentThreat (lib/squad.ts) — the target-room composition data ColonySnapshot.hostileRoomUnits
 * closes the gap for (see its doc: `hostiles` alone is home-room-only, useless for a squad fighting away
 * from home). An unarmed hostile (no ATTACK/RANGED_ATTACK parts — e.g. a harmless scout) is excluded: it's
 * not a threat the formation needs to orient toward. */
function threatsIn(colony: ColonySnapshot, room: string): Threat[] {
  const units = colony.hostileRoomUnits[room] ?? [];
  const towers = colony.hostileRoomTowers[room] ?? [];
  const unitThreats: Threat[] = units
    .filter(u => u.attackParts > 0 || u.rangedAttackParts > 0)
    .map(u => ({ x: u.x, y: u.y, engageRange: u.attackParts > 0 ? MELEE_ENGAGE_RANGE : RANGED_ENGAGE_RANGE }));
  const towerThreats: Threat[] = towers.map(t => ({ x: t.x, y: t.y, engageRange: Infinity }));
  return [...unitThreats, ...towerThreats];
}

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

  /** The squad's occupancy source (closes docs/drain-squad-handoff.md's open issue #2's pathing half) —
   * drainRoomOccupancy's raw grid marks EVERY live creep, including the squad's OWN members (it's built
   * from a room-wide FIND_CREEPS with no notion of "which squad is asking" — see OccupancySource's doc,
   * squadPath.ts). A squad's own current tiles must never read as blocking itself (planSquadMove's
   * fit-checks would otherwise report the squad's own already-occupied slot tiles as unfit, holding it in
   * place forever) — this wrapper clears those tiles from a cloned copy of the raw grid before returning
   * it, cheap since a drain squad is at most a handful of creeps. Vision-gated same as the underlying
   * field: a room with no entry (no vision this tick) fails open to "nothing occupied." */
  public occupancy(colony: ColonySnapshot): OccupancySource {
    const squad = this.squad(colony);
    return room => {
      const raw = colony.drainRoomOccupancy[room];
      if (!raw) return undefined;
      const mine = squad.filter(c => c.room === room);
      if (mine.length === 0) return raw;
      const grid = raw.slice();
      for (const c of mine) grid[c.x * 50 + c.y] = 0;
      return grid;
    };
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
   * ADR 0006's recompute-every-tick rule). The attacker IS the anchor slot, so its tile (x, y, AND room —
   * all three read off the SAME creep's SAME snapshot, so they can never internally disagree) is the anchor
   * when it's alive. With the attacker dead (a degraded formation retreating as-is, ADR 0007), the anchor
   * slot is vacant but still the formation's reference point — inferred from a surviving healer minus its
   * slot offset, again reading x/y/room all off that SAME healer, so the block keeps a consistent anchor to
   * reform/move around. Deterministic (first healer by name) so two ticks with identical input agree.
   *
   * Takes ONLY the attacker/healers — never a separately-computed `room` parameter. A caller that voted a
   * room from the wider squad (or the joined set) and passed it in here could hand back an anchor whose
   * x/y come from one member's position but whose room reflects a DIFFERENT member (or a stale vote) —
   * exactly handoff open issue #1's bug: the attacker crossed a border alone, its x/y were already its new
   * room's local coordinates, but a separately-voted `room` still reflected the room the rest of the squad
   * held, producing a nonsensical hybrid anchor like `{x:0, y:8, room:"W6N3"}` where (0,8) was actually the
   * attacker's position in W5N3. No default fallback is fabricated here either: an empty squad is the
   * caller's problem to guard against (squadState already returns undefined before reaching this), not a
   * harmless {25,25} default that could paper over a real bug elsewhere. */
  private anchorTile(attacker: SnapCreep | undefined, healers: readonly SnapCreep[], facing: DirectionConstant): XY & { room: string } {
    if (attacker) return { x: attacker.x, y: attacker.y, room: attacker.room };
    // Attacker slot vacant: place the anchor so the first healer (deterministic) sits on its own slot tile.
    // Healer slots at the canonical facing are (1,0),(0,1),(1,1); the anchor is that healer's tile minus
    // its rotated offset. We use the first healer and the first healer slot for a stable reference.
    const healer = [...healers].sort((a, b) => a.name.localeCompare(b.name))[0];
    // No healer either: squadState never calls this on an empty squad (it returns undefined first), so this
    // is unreachable in practice — asserted rather than defaulted, since a silent {25,25,""} anchor would
    // mask whatever caller-side bug got here instead.
    if (!healer) throw new Error("Drain.anchorTile: called with no attacker and no healers");
    // The first healer slot offset (1,0) rotated to the current facing.
    const off = rotatedHealerOffset(facing);
    return { x: healer.x - off.dx, y: healer.y - off.dy, room: healer.room };
  }

  /** The SquadState the generic Squad entity runs on this tick, or undefined while the squad is still
   * ASSEMBLING (rallying to staging via independent movement — that behaviour is unchanged, ADR 0007
   * requirement 2, and handled by the members' own step tables, NOT the squad machinery). Once assembled
   * and underway, returns a state whose members are exactly the STATEFULLY joined set (CreepMemory.
   * squadJoined) — bootstrapped or grown by the join/re-entry logic below, and persisted via
   * `joinIntents()`'s setSquadJoined writes so the same decision holds on every subsequent tick. */
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

    // Squad membership is now STATEFUL (CreepMemory.squadJoined), not re-derived from live position every
    // tick. A creep joins once (see `joinIntents` below, called from `intents()`) and stays a member until
    // explicitly cleared — never silently dropped out of the plan just because its position momentarily
    // reads ambiguously (the border-straddle flicker this replaces: a formation legitimately straddles two
    // rooms for a tile or two mid-crossing, and any purely-positional per-tick membership test — room
    // equality, then world-coordinate range — can (and, confirmed live, did) flip a straddling member in
    // and out of the plan tick to tick even though nothing about whether it belongs actually changed).
    let joined = squad.filter(c => c.memory.squadJoined === this.name);
    if (joined.length === 0) {
      // Bootstrap: NOBODY has joined yet (fresh assembly going underway for the first time, OR a squad
      // handed to squadState already fully underway with no prior squadJoined state at all — e.g. this
      // operation restarting mid-drain) — the whole assembled squad becomes members together immediately
      // rather than waiting a tick for intents() to catch up (intents()'s joinIntents grants the identical
      // set this same tick — see its doc). A squad freshly arrived in staging rallied independently to the
      // room's center and isn't necessarily welded into a tight formation shape yet, so this is
      // unconditional, not range-gated.
      joined = squad;
    } else {
      // Re-entry: at least one member is already governed by squad machinery — a not-yet-joined squadmate
      // (a replacement that spawned after the squad had already pushed off) is added to THIS tick's members
      // once it's within the formation's own footprint radius (world-coordinate, cross-room) of the
      // already-joined block's own anchor reference — guarding against a still-distant straggler being
      // swept into the plan (and thus skipping its own step table via runSquads' membership set) before
      // it's actually close enough to matter. Computed against the JOINED set's own anchor room (not yet
      // this function's own `anchor`, defined below from `joined` — a straggler catching up while the block
      // is mid-crossing must be tested against where the ALREADY-joined block actually is).
      const refRoom = mostCommonRoom(joined);
      const refPos = anchorReference(joined, refRoom);
      const refWorld = worldOf(refPos.x, refPos.y, refRoom);
      const joinRadius = Math.max(...DRAIN_FORMATION.map(s => Math.max(Math.abs(s.dx), Math.abs(s.dy))), 0);
      const rejoining = squad.filter(c => {
        if (c.memory.squadJoined === this.name) return false;
        const w = worldOf(c.x, c.y, c.room);
        return Math.max(Math.abs(w.wx - refWorld.wx), Math.abs(w.wy - refWorld.wy)) <= joinRadius;
      });
      if (rejoining.length > 0) joined = [...joined, ...rejoining];
    }

    // A PROVISIONAL room, used ONLY to pick which room's threats to look at before the real anchor exists
    // below — never fed into the anchor itself (see anchorTile's doc for why: a vote here mixed with one
    // member's x/y elsewhere is exactly handoff open issue #1's bug). Before the first push that's simply
    // the staging room (the whole squad is physically there); once underway it's the joined set's mode room
    // — a rough "where's most of the squad" read that's fine for threat-lookup purposes, since a wrong guess
    // here only means checking the wrong room's (usually empty) threat list for one tick, not a corrupted
    // anchor position.
    const threatLookupRoom = readyForFirstPush ? staging : mostCommonRoom(joined);
    const goal = this.goalTile(colony, squad, staging);
    const threatRef = anchorReference(joined, threatLookupRoom);
    // Face the nearest THREAT, not the travel goal, whenever one is actually present in the anchor room —
    // a squad mid-fight needs to keep its attacker (the anchor slot, always the formation's "front" at any
    // axis facing) oriented toward whatever's hitting it, not toward wherever it happens to be walking.
    // Falls back to the ordinary goal-directed drainFacing when the room is clear (nothing to react to) or
    // has no vision this tick (threatsIn reads empty, same fail-open convention as hostileRoomTowers).
    const threat = mostUrgentThreat(threatRef, threatsIn(colony, threatLookupRoom));
    const desiredFacing = threat ? drainFacing(threatRef, threat) : drainFacing(threatRef, goal);
    // THE anchor — every field (x, y, room) derived from ONE reference creep's own live snapshot via
    // anchorTile (see its doc), never a separately-voted room. `desiredFacing` only affects the degraded
    // (attacker-dead) case's healer-offset direction here; it does not influence anchor.room either way.
    const anchor = this.anchorTile(
      joined.find(c => c.role === "drainAttacker"),
      joined.filter(c => c.role === "drainHealer"),
      desiredFacing
    );
    const members = joined;
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
      `drain squadState: readyForFirstPush=${readyForFirstPush} underway=${underway} threatLookupRoom=${threatLookupRoom} ` +
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
    const squad = this.squad(colony);
    const out: Intent[] = [];

    // Squad dissolved (draining cleared): clear squadJoined off every still-alive former member so a
    // leftover creep from a stopped operation doesn't carry stale membership state into whatever it does
    // next (see CreepMemory.squadJoined's doc — membership must never survive the thing that granted it).
    // Only clears OUR OWN squad's membership (=== this.name) — never a different op's, in case a role were
    // ever repurposed across squad-bearing operations.
    if (!colony.draining) {
      for (const c of squad) if (c.memory.squadJoined === this.name) out.push({ kind: "clearSquadJoined", creep: c.id });
      return out;
    }
    const staging = pickStagingRoom(colony.drainRoute);
    if (!staging) return out;

    const state = this.squadState(colony);
    out.push(...this.joinIntents(squad, state));

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

  /** Emits `setSquadJoined` for every squad member that has newly earned membership this tick — the write
   * side of CreepMemory.squadJoined (squadState only READS the flag; this is the sole place it's granted).
   * Simply mirrors squadState's OWN membership decision for `state` (already computed this tick, reused
   * here so the write side can never disagree with the read side): every member squadState resolved into
   * `state.members` that doesn't already carry the flag gets it now. That decision is itself either the
   * all-or-nothing bootstrap (nobody's joined yet — the whole assembled squad becomes members together,
   * since a squad freshly arrived in staging rallied independently to the room's center and isn't
   * necessarily welded into a tight formation shape yet) or, once at least one member is already joined,
   * the range-gated re-entry test (a replacement joins only once it's within the formation's own footprint
   * of the live anchor) — see squadState's own doc for exactly which. This fires ONCE per creep (a state
   * transition), not re-evaluated as ground truth every tick — the border-straddle flicker this whole
   * mechanism replaces came from re-deriving "is this creep part of the squad right now" from live position
   * fresh every tick, which could (and, confirmed live, did) flip a genuinely unchanged membership fact tick
   * to tick. */
  private joinIntents(squad: readonly SnapCreep[], state: SquadState | undefined): Intent[] {
    if (!state) return [];
    const memberIds = new Set(state.members.map(m => m.id));
    return squad
      .filter(c => memberIds.has(c.id) && c.memory.squadJoined !== this.name)
      .map(c => ({ kind: "setSquadJoined", creep: c.id, op: this.name }));
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

// The room most of the squad's members currently stand in. NO LONGER used to derive the formation's
// anchor room (see anchorTile's doc — that was handoff open issue #1's bug: a majority vote could disagree
// with the SAME anchor's own x/y whenever the attacker itself was the outlier, e.g. having just crossed a
// border alone). Its two remaining callers are both lower-stakes "roughly where's the squad" reads that
// tolerate an occasionally-wrong guess without corrupting anything: which room's threat list to consult for
// facing (a wrong guess just means checking an empty list for one tick) and the re-entry join-radius gate's
// reference room (a wrong guess there only delays a straggler's join by a tick, never joins/excludes
// incorrectly on its own — the actual range check still uses real world-coordinate distance).
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
