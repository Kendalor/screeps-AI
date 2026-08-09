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
import { assertSquareTopLeftAnchor, slotTiles, type Formation } from "../lib/formation";
import { range, worldOf, type XY } from "../lib/geometry";
import { log } from "../lib/log";
import {
  inFormation,
  mostUrgentThreat,
  planSquadMove,
  reformAssignment,
  reformOnto,
  type ActionIntent,
  type SquadActionPlanner,
  type SquadMovePlan,
  type SquadState,
  type Threat
} from "../lib/squad";
import type { OccupancySource, TerrainSource } from "../lib/squadPath";
import type { ColonySnapshot, SnapCreep, SnapTower } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

const DRAIN_HEALER_COUNT = 3;
const DRAIN_SQUAD_SIZE = 1 + DRAIN_HEALER_COUNT;

// Drain's formation as data (ADR 0007): the attacker is the anchor slot at (0,0), the three healers fill
// the other three tiles of a fixed 2x2 block trailing right/down of the anchor. The box's tile-set never
// rotates (formation.ts's module header) — every member is within range 1 of every other at all times by
// construction, regardless of which live creep occupies which tile. WHICH creep (attacker vs. which healer)
// ends up on which of the 4 fixed tiles is a placement preference Drain resolves itself (see
// Drain.planMove below) — the generic squad layer has no notion of it at all.
export const DRAIN_FORMATION: Formation = [
  { dx: 0, dy: 0, role: "drainAttacker" },
  { dx: 1, dy: 0, role: "drainHealer" },
  { dx: 0, dy: 1, role: "drainHealer" },
  { dx: 1, dy: 1, role: "drainHealer" }
];
// Fails loudly at module load if DRAIN_FORMATION ever stops satisfying the square/top-left-anchor
// constraint squad pathing requires (see formation.ts's assertSquareTopLeftAnchor) — a violation should
// surface immediately, not get buried inside a pathfinder result a tick later.
assertSquareTopLeftAnchor(DRAIN_FORMATION);

/** The first room along `route` (home -> target, see ColonySnapshot.drainRoute) where ScoutInfo.hostile
 * is false — an unscouted room defaults to `hostile: false` at the snapshot boundary already, so this
 * function itself doesn't need to special-case "never scouted" separately (ADR 0006's staging-room rule).
 * Undefined when the route is empty or every room on it is hostile — Drain then has nowhere safe to
 * rendezvous the squad and holds everything at home. Pure: takes plain data, no Game access. */
export function pickStagingRoom(route: readonly { room: string; hostile: boolean }[]): string | undefined {
  return route.find(r => !r.hostile)?.room;
}

// A melee hostile's engage range (adjacent) vs. a ranged one's (RANGED_ATTACK's max range) — a mixed body
// (both part types) is classified melee since that's the tighter, more urgent range: it can still land a
// melee hit the instant it's adjacent regardless of also carrying RANGED_ATTACK parts.
const MELEE_ENGAGE_RANGE = 1;
const RANGED_ENGAGE_RANGE = 3;

/** The visible hostile creeps and towers in `room` as generic Threat entries for mostUrgentThreat
 * (lib/squad.ts) — the target-room composition data ColonySnapshot.hostileRoomUnits closes the gap for
 * (see its doc: `hostiles` alone is home-room-only, useless for a squad fighting away from home). An
 * unarmed hostile (no ATTACK/RANGED_ATTACK parts — e.g. a harmless scout) is excluded: it's not a threat
 * the formation needs to orient toward. */
function threatsIn(colony: ColonySnapshot, room: string): Threat[] {
  const units = colony.hostileRoomUnits[room] ?? [];
  const towers = colony.hostileRoomTowers[room] ?? [];
  const unitThreats: Threat[] = units
    .filter(u => u.attackParts > 0 || u.rangedAttackParts > 0)
    .map(u => ({ x: u.x, y: u.y, engageRange: u.attackParts > 0 ? MELEE_ENGAGE_RANGE : RANGED_ENGAGE_RANGE }));
  const towerThreats: Threat[] = towers.map(t => ({ x: t.x, y: t.y, engageRange: Infinity }));
  return [...unitThreats, ...towerThreats];
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
  private anchorTile(attacker: SnapCreep | undefined, healers: readonly SnapCreep[]): XY & { room: string } {
    if (attacker) return { x: attacker.x, y: attacker.y, room: attacker.room };
    // Attacker slot vacant: place the anchor so the first healer (deterministic) sits on its own slot tile.
    // The first healer slot's FIXED offset is (1,0) (DRAIN_FORMATION) — never rotated — so the anchor is
    // simply that healer's tile minus (1,0), no facing to back out.
    const healer = [...healers].sort((a, b) => a.name.localeCompare(b.name))[0];
    // No healer either: squadState never calls this on an empty squad (it returns undefined first), so this
    // is unreachable in practice — asserted rather than defaulted, since a silent {25,25,""} anchor would
    // mask whatever caller-side bug got here instead.
    if (!healer) throw new Error("Drain.anchorTile: called with no attacker and no healers");
    return { x: healer.x - 1, y: healer.y, room: healer.room };
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

    // THE anchor — a PERSISTED value (ColonyMemory.drainAnchor, see its doc) read straight off the
    // snapshot in steady state, never re-derived from a live creep's position once it exists. Falls back
    // to the live-position derivation (anchorTile, see its doc) only when nothing is persisted yet — the
    // very first tick a squad ever welds up, before intents() has had a chance to seed it (seeded this
    // same tick via setDrainAnchor below, mirroring joinIntents' own "grant the identical decision this
    // tick" pattern) — so a colony resuming mid-drain (this operation restarting) or freshly bootstrapping
    // never briefly reads an undefined anchor.
    const anchor = colony.drainAnchor ?? this.anchorTile(joined.find(c => c.role === "drainAttacker"), joined.filter(c => c.role === "drainHealer"));
    const members = joined;
    log.debugRoom(
      colony.name,
      `drain squadState: readyForFirstPush=${readyForFirstPush} underway=${underway} ` +
        `anchor=(${anchor.x},${anchor.y},${anchor.room}) ` +
        `squad=[${squad.map(c => `${c.name}@${c.room}(${c.x},${c.y})`).join(",")}] members=[${members.map(c => c.name).join(",")}]`
    );
    if (members.length === 0) return undefined;
    return { members, formation: DRAIN_FORMATION, anchor };
  }

  /** SquadBearingOperation's optional planMove hook (empire/creeps.ts): Drain's own wrapper around the
   * generic planSquadMove (lib/squad.ts), adding the ONE piece of placement preference the generic layer
   * deliberately knows nothing about: the attacker should end up on
   * whichever of the formation's 4 FIXED tiles is nearest the current threat (or the goal, absent one) — a
   * real tactical need (an attacker facing away from what's hitting it fights at a disadvantage), but NOT a
   * geometric rotation (see formation.ts's module header and DRAIN_FORMATION's own doc: the box's tiles
   * never rotate; only which live creep sits on which fixed tile can change).
   *
   * Only applies during a REFORM (planSquadMove's "not tight" branch) — an already-tight, already-advancing
   * squad has every member on some slot already (including the attacker on whichever one it's on); nothing
   * to bias. Two-phase assignment: (1) find the tile nearest the threat/goal among the reform target's own
   * slot tiles, (2) assign the attacker there FIRST via reformAssignment (nearest attacker to that one
   * tile — trivial with a single attacker, but reuses the same primitive rather than a bespoke one-off), (3)
   * defer to planSquadMove's own ordinary reform for every other member onto the remaining slots. This
   * deliberately bypasses slotChainRepair for the attacker's own move (accepted — see the design doc: the
   * attacker is a single always-present member, not a variable-count group a doorway jam could strand). */
  public planMove(
    state: SquadState,
    goal: XY & { room: string },
    colony: ColonySnapshot,
    terrain: TerrainSource,
    now: number,
    occupancy: OccupancySource
  ): SquadMovePlan {
    const plain = planSquadMove(state, goal, terrain, now, occupancy);
    const attacker = state.members.find(m => m.role === "drainAttacker");
    if (!attacker) return plain; // no attacker to bias toward anything

    // Only bias a REFORM — checked against the CURRENT anchor's slots (state.anchor), never plan.anchor:
    // during an ordinary tight advance, plan.anchor is already the NEXT tick's anchor, so checking
    // inFormation against ITS slots would compare the members' CURRENT (pre-move) positions to where
    // they're headed next — always false mid-advance — and wrongly fall through to the reform-bias branch
    // every single tick of an otherwise-ordinary lockstep advance, discarding planSquadMove's own
    // same-index advanceOnto matching in favor of a plain nearest-distance reform. That mismatch is exactly
    // what produced a perpetual oscillation in one member once the block was moving (confirmed via the
    // real-engine border-crossing integration test).
    const currentSlots = slotTiles(state.anchor, state.formation);
    if (inFormation(state.members, currentSlots)) return plain; // already tight — nothing to reform, no bias to apply

    const reformSlots = slotTiles(plain.anchor, state.formation);
    const threatRoom = mostCommonRoom(state.members);
    const threat = mostUrgentThreat(attacker, threatsIn(colony, threatRoom));
    const preferred = threat ?? goal;
    const preferredTile = reformSlots.reduce((best, s) => (range(s, preferred) < range(best, preferred) ? s : best), reformSlots[0]);

    const attackerAssignment = reformAssignment([{ id: attacker.id, pos: attacker }], [preferredTile]);
    const attackerTo = attackerAssignment.get(attacker.id);
    if (!attackerTo) return plain; // shouldn't happen with one member/one destination, but stay total

    const rest = state.members.filter(m => m.id !== attacker.id);
    const remainingSlots = reformSlots.filter(s => s.x !== preferredTile.x || s.y !== preferredTile.y || s.room !== preferredTile.room);
    const restMoves = reformOnto(rest, remainingSlots, terrain);
    return {
      moves: [{ creep: attacker.id, to: { x: attackerTo.x, y: attackerTo.y, room: reformSlots[0]?.room ?? attacker.room } }, ...restMoves],
      anchor: plain.anchor
    };
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

  /** SquadBearingOperation's setSquadAnchor hook (empire/creeps.ts's runSquads): persists a corrected/
   * advanced anchor the moment planMove's own SquadMovePlan.anchor differs from what squadState reported
   * this tick — the write side of the persisted-anchor contract (see ColonyMemory.drainAnchor's doc).
   * Called at most once per tick, only when the value actually changed. */
  public setSquadAnchor(colony: ColonySnapshot, anchor: XY & { room: string }): Intent[] {
    return [{ kind: "setDrainAnchor", room: colony.name, anchor }];
  }

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

    // Seed the persisted anchor (ColonyMemory.drainAnchor) the moment a squad state first exists but
    // nothing is stored yet — mirrors joinIntents' own "grant this tick's already-computed decision"
    // pattern: squadState already fell back to the live-position derivation for `state.anchor` above, so
    // this simply writes that same value through rather than leaving it to be silently recomputed (and
    // potentially drift) every tick until some OTHER path happens to persist it.
    if (state && !colony.drainAnchor) {
      out.push({ kind: "setDrainAnchor", room: colony.name, anchor: state.anchor });
    }

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

// The set of rooms on the route that lie BEYOND the staging room toward the target (staging's successors,
// target included) — "underway" territory. A room before staging (a transit room the squad is still
// walking through to reach staging) is not in this set.
function roomsBeyondStaging(route: readonly { room: string }[], staging: string): Set<string> {
  const idx = route.findIndex(r => r.room === staging);
  if (idx < 0) return new Set();
  return new Set(route.slice(idx + 1).map(r => r.room));
}

// A reference tile for the squad's rough position in `room` — the attacker's tile when present, else the
// first squad member's. Used by the re-entry join-radius gate (squadState) to test a straggler's distance.
function anchorReference(squad: readonly SnapCreep[], room: string): XY {
  const attacker = squad.find(c => c.role === "drainAttacker" && c.room === room);
  const ref = attacker ?? squad.find(c => c.room === room) ?? squad[0];
  return { x: ref?.x ?? 25, y: ref?.y ?? 25 };
}

// The room most of the squad's members currently stand in. NO LONGER used to derive the formation's
// anchor room (see anchorTile's doc — that was handoff open issue #1's bug: a majority vote could disagree
// with the SAME anchor's own x/y whenever the attacker itself was the outlier, e.g. having just crossed a
// border alone). Its remaining callers are both lower-stakes "roughly where's the squad" reads that
// tolerate an occasionally-wrong guess without corrupting anything: which room's threat list to consult for
// planMove's attacker bias (a wrong guess just means checking an empty list for one tick) and the re-entry
// join-radius gate's reference room (a wrong guess there only delays a straggler's join by a tick, never
// joins/excludes incorrectly on its own — the actual range check still uses real world-coordinate distance).
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
