// Drain Energy (issue #34/ADR 0006): one fixed 4-creep squad (1 drainAttacker + 3 drainHealer) sent at a
// single target room (ColonyMemory.draining, snapshot.draining — a scalar, unlike Attack's `attacking`
// list, because exactly one drain target per colony is load-bearing for squad membership being derived
// from `op` alone, no squadId — see ADR 0006). Squad membership is every creep sharing this operation's
// `op` stamp (Operation.owned()), same pattern Attack/Defense already use.

import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import { incomingHeal, towerDamageAt, type HealSource } from "../lib/combat";
import { followerOffsets } from "../lib/formation";
import { range, type XY } from "../lib/geometry";
import { log } from "../lib/log";
import type { ColonySnapshot, SnapCreep, SnapTower } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

const DRAIN_HEALER_COUNT = 3;
const DRAIN_SQUAD_SIZE = 1 + DRAIN_HEALER_COUNT;

/** The first room along `route` (home -> target, see ColonySnapshot.drainRoute) where ScoutInfo.hostile
 * is false — an unscouted room defaults to `hostile: false` at the snapshot boundary already, so this
 * function itself doesn't need to special-case "never scouted" separately (ADR 0006's staging-room rule).
 * Undefined when the route is empty or every room on it is hostile — Drain then has nowhere safe to
 * rendezvous the squad and holds everything at home. Pure: takes plain data, no Game access. */
export function pickStagingRoom(route: readonly { room: string; hostile: boolean }[]): string | undefined {
  return route.find(r => !r.hostile)?.room;
}

/** A step directly toward `to` from `from` — one of the 8 compass tiles, whichever best reduces the
 * distance, clamped to a single tile. Pure XY math, no Game access. Tile-level stepping only makes sense
 * within one room's 0-49 grid; when `from` and `to` sit in different rooms, `to` is returned unchanged —
 * moveToPos's travelTo already paths (and crosses room borders) toward any RoomPosition on its own, one
 * tile per tick for a 1:1 MOVE-ratio squad body, so handing it the aim point directly still yields the
 * same "one step at a time" behaviour this function computes explicitly for the same-room case. */
function stepToward(from: XY & { room: string }, to: XY & { room: string }): XY & { room: string } {
  if (from.room !== to.room) return to;
  return { x: from.x + Math.sign(to.x - from.x), y: from.y + Math.sign(to.y - from.y), room: to.room };
}

/** DirectionConstant for a single-tile step — mirrors Screeps' own getDirection, hand-rolled since this
 * runs in the pure-planner boundary (no RoomPosition available). */
function directionOf(from: XY, to: XY): DirectionConstant {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy < 0) return TOP;
  if (dx > 0 && dy < 0) return TOP_RIGHT;
  if (dx > 0 && dy === 0) return RIGHT;
  if (dx > 0 && dy > 0) return BOTTOM_RIGHT;
  if (dx === 0 && dy > 0) return BOTTOM;
  if (dx < 0 && dy > 0) return BOTTOM_LEFT;
  if (dx < 0 && dy === 0) return LEFT;
  return TOP_LEFT; // dx < 0 && dy <= 0 (including dx===0&&dy===0, an arbitrary but harmless default)
}

/** Projected tower damage against the squad's current heal output, at candidate leader position
 * `nextPos` — the ADR 0006 continuous advance/retreat rule: every tower currently visible in the target
 * room (colony.hostileRoomTowers), summed at its own distance from `nextPos`, versus what the squad can
 * heal through (incomingHeal, fed every alive healer as a HealSource — approximated at the LEADER's next
 * position for all of them, since the formation is a rigid range-1 block that moves together, so every
 * healer is within heal-assist range of the leader's tile either way). Advance is safe exactly when heal
 * output at least matches projected damage. No towers visible at all reads as safe (nothing to project). */
function advanceIsSafe(nextPos: XY, towers: readonly SnapTower[], healers: readonly HealSource[]): boolean {
  if (towers.length === 0) return true;
  const projectedDamage = towers.reduce((sum, t) => sum + towerDamageAt(range(t, nextPos)), 0);
  return projectedDamage <= incomingHeal(nextPos, healers);
}

// One representative DirectionConstant per each of the 4 distinct 2x2-block orientations formation.ts's
// QUADRANT collapses 8 compass directions down to — see followerOffsets' own doc for why only 4 exist.
const ORIENTATIONS: DirectionConstant[] = [TOP, RIGHT, BOTTOM, LEFT];

function walkable(terrain: Uint8Array | undefined, x: number, y: number): boolean {
  // No terrain data on record for this room (shouldn't happen — drainRoomTerrain covers `draining` and
  // every drainRoute room — but Drain must never brick a squad on a snapshot gap) reads as walkable, the
  // same fail-open convention pickStagingRoom uses for an unscouted room's hostile flag.
  if (!terrain) return true;
  if (x < 0 || x > 49 || y < 0 || y > 49) return false;
  return terrain[x * 50 + y] === 1;
}

/** Whether the leader-at-`pos` + followerOffsets(pos, direction) block is entirely walkable — the actual
 * 2x2 formation Drain is about to commit the squad to, not just the leader's own tile. `terrain` is
 * `colony.drainRoomTerrain[pos.room]`, absent only for a room the snapshot boundary didn't cover (see
 * walkable's fail-open doc). */
function blockIsWalkable(pos: XY, direction: DirectionConstant, terrain: Uint8Array | undefined): boolean {
  if (!walkable(terrain, pos.x, pos.y)) return false;
  return followerOffsets(pos, direction).every(o => walkable(terrain, o.x, o.y));
}

/** The best orientation for a 2x2 block anchored at `pos`: the natural direction of travel (`preferred`)
 * if its block is fully walkable, else whichever of the other 3 fixed orientations (see ORIENTATIONS) is
 * — deterministic order, so two ticks with identical inputs always agree. Undefined when EVERY
 * orientation at this tile hits a wall (a leader tile boxed in on at least 3 of its 4 quadrants), the
 * signal to hold rather than commit to a block that can never be fully occupied. Confirmed live on
 * shard0 (2026-08-05): a follower's assigned formation slot landed on a solid wall tile it could never
 * physically reach, holding the whole squad frozen forever — the inFormation gate correctly waited for a
 * straggler that in fact could never arrive, because nothing had checked the slot was reachable before
 * assigning it. */
function walkableOrientation(pos: XY, preferred: DirectionConstant, terrain: Uint8Array | undefined): DirectionConstant | undefined {
  if (blockIsWalkable(pos, preferred, terrain)) return preferred;
  return ORIENTATIONS.find(d => d !== preferred && blockIsWalkable(pos, d, terrain));
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

  /** One role's deficit toward the fixed composition — same shape as Operation.fillRole, but Drain's
   * targetRoom/spawnRoom are pinned to the HOME colony (colony.name), not `fillTo`'s default (also
   * colony.name via memory.home, but spelled out here since a drain squad's spawn location is never in
   * question the way a per-target requester's might be — see spawn/request.ts's fillTo doc). */
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

  /** Every live squad member, attacker first when present (leader-first ordering — see leaderOf). */
  private squad(colony: ColonySnapshot): SnapCreep[] {
    return [...this.owned(colony, "drainAttacker"), ...this.owned(colony, "drainHealer")];
  }

  public override intents(colony: ColonySnapshot): Intent[] {
    if (!colony.draining) return [];
    const staging = pickStagingRoom(colony.drainRoute);
    if (!staging) return []; // no safe room anywhere on the route — nothing safe to do yet

    const squad = this.squad(colony);
    const attacker = this.owned(colony, "drainAttacker")[0];
    const healers = this.owned(colony, "drainHealer");
    const assembled = attacker !== undefined && healers.length >= DRAIN_HEALER_COUNT && squad.length >= DRAIN_SQUAD_SIZE;

    // ADR 0006's assembly gate governs the squad's FIRST push out of the staging room: below full
    // strength, hold everyone there. At full strength but not yet all physically together in the staging
    // room, also hold. Once every member has been seen together in the staging room at least once, the
    // leader alone (see below) drives advance/retreat from then on; this initial "all four together"
    // check is deliberately based on current position each tick, not persisted state (out of scope for
    // this slice — see ADR 0006's deferred loss/reassembly), so it re-observes true the moment a fully
    // assembled squad is actually standing there, which is the only case that needs to.
    const readyForFirstPush = assembled && squad.every(c => c.room === staging);
    const leader = assembled ? leaderOf(attacker, healers) : undefined;
    const alreadyUnderway = leader !== undefined && leader.room !== staging;

    // Every squad member's squadTargetPos is set fresh EVERY tick this operation runs, whichever branch
    // below computes it — the sole source of truth for where a drain creep should be, chased by the
    // role's one moveToPos step (see drainHealer.ts/drainAttacker.ts). No moveToRoom + moveToPos two-step
    // handoff: that split let a straggler's step cursor latch onto moveToPos while chasing a stale
    // position from an earlier tick, with nothing to ever send it back to a room-crossing step — a real
    // stuck state confirmed live on shard0 (2026-08-05), a healer that spawned before this operation's
    // per-tick pass ever reached it sat motionless in its home room for hundreds of ticks even after
    // everything else recovered. A single always-fresh target can't go stale the same way: whatever
    // squadTargetPos says this tick is simply where the creep walks, full stop.
    if (!readyForFirstPush && !alreadyUnderway) {
      // Rally point: every member (including any straggler still at home) heads for the staging room's
      // centre. No formation discipline needed yet — that only matters once advancing into contested
      // territory (below); a loose rally is enough to get everyone physically together.
      const rally = { x: 25, y: 25, room: staging };
      return [...squad.map(c => ({ kind: "setSquadTargetPos" as const, creep: c.id, pos: rally })), ...this.drainSample(colony)];
    }
    // Guaranteed defined: both readyForFirstPush and alreadyUnderway require assembled === true.
    const definiteLeader = leader!;
    const leaderPos: XY & { room: string } = { x: definiteLeader.x, y: definiteLeader.y, room: definiteLeader.room };
    const followers = squad.filter(c => c.id !== definiteLeader.id);

    // The leader may only take its next step once the squad is ALREADY a tight 2x2 block — same room,
    // every follower within range 1 (Chebyshev) of the leader's CURRENT tile. A block that size has max
    // internal range 1 between any two members, so "every follower within range 1 of the leader" alone
    // guarantees mutual range-1 for the whole squad, not just leader-to-follower. Without this gate the
    // leader advanced/retreated every tick regardless of whether followers had caught up — confirmed live
    // on shard0 (2026-08-05): a wounded healer left several tiles behind a still-advancing leader, well
    // outside heal-assist range, taking tower fire it should have been retreating out of instead. Holding
    // the leader in place (its own current tile, not a new candidate) lets stragglers close the gap; once
    // formed up, the very next tick's re-check immediately resumes the real advance/retreat decision — no
    // separate "regrouping" state, just this same check re-evaluated fresh.
    const inFormation = followers.every(f => f.room === leaderPos.room && range(f, leaderPos) <= 1);

    // "Deeper into the target room" and "back toward the staging room" are both just travelTo aim points
    // (moveToPos's travelTo handles the actual multi-tile path, including crossing the room border) —
    // each tick re-evaluates the aim point fresh from the leader's current position, which is what makes
    // "one step at a time" and "re-open advance the instant it's safe again" the same mechanism (ADR
    // 0006's one continuous rule, not a separate attrition/breach state).
    const advanceAim: XY & { room: string } = { x: 25, y: 25, room: colony.draining };
    const retreatAim: XY & { room: string } = { x: 25, y: 25, room: staging };

    const towers = colony.hostileRoomTowers[colony.draining] ?? [];
    const healSources: HealSource[] = healers.map(h => ({ x: h.x, y: h.y, healParts: healPartsOf(h) }));
    // advanceIsSafe only projects ONE tile ahead (would this next step's incoming tower damage exceed
    // what the squad can heal through THIS tick) — it has no memory of damage already sustained, so on
    // its own it will happily walk an already-wounded squad straight back into fire the instant a single
    // tile looks individually survivable. fullyHealed gates advancing (never retreating/holding — a hurt
    // squad must always be free to disengage) on every member being at full HP, so a retreat actually
    // means "fall back and let heal top everyone up" rather than "reverse for one tile and immediately
    // push again." Confirmed live on shard0 (2026-08-05): a healer took real tower damage and died mid
    // engagement because the per-tile check alone kept re-approving advance while the squad was still hurt.
    const fullyHealed = squad.every(c => c.hits >= c.hitsMax);

    let nextPos: XY & { room: string };
    let aim: XY & { room: string };
    if (!inFormation) {
      // Hold the leader exactly where it stands — a real, current tile, not a moving target — so
      // followerOffsets below computes slots the stragglers can actually converge on this tick.
      nextPos = leaderPos;
      aim = leaderPos;
    } else {
      // The candidate tile actually checked is one step toward the advance aim (not the aim point
      // itself) — "the NEXT candidate position", per ADR 0006, so a room's center far away doesn't get
      // pre-emptively rejected by towers near the border it hasn't reached yet.
      const nextStepCandidate = stepToward(leaderPos, advanceAim);
      const safe = fullyHealed && advanceIsSafe(nextStepCandidate, towers, healSources);
      aim = safe ? advanceAim : retreatAim;
      nextPos = safe ? nextStepCandidate : stepToward(leaderPos, retreatAim);
    }

    // The block anchored at nextPos must be entirely walkable in SOME orientation, or the whole move is
    // rejected — a follower assigned a wall tile can never physically reach it, which would otherwise
    // freeze the squad forever waiting on the inFormation gate above for a straggler that can't arrive
    // (confirmed live on shard0, 2026-08-05 — see walkableOrientation's doc). Falls back to holding at
    // leaderPos (the CURRENT tile, already proven reachable since the squad is standing on it) rather
    // than committing to nextPos at all when no orientation there works.
    const terrain = colony.drainRoomTerrain[nextPos.room];
    const preferredDirection = directionOf(leaderPos, aim);
    const orientation = walkableOrientation(nextPos, preferredDirection, terrain);
    const finalPos = orientation ? nextPos : leaderPos;
    const finalDirection = orientation ?? walkableOrientation(leaderPos, preferredDirection, colony.drainRoomTerrain[leaderPos.room]) ?? preferredDirection;
    const offsets = followerOffsets(finalPos, finalDirection);

    const out: Intent[] = [{ kind: "setSquadTargetPos", creep: definiteLeader.id, pos: finalPos }];
    followers.forEach((follower, i) => {
      const offset = offsets[i];
      if (!offset) return;
      out.push({ kind: "setSquadTargetPos", creep: follower.id, pos: { x: offset.x, y: offset.y, room: finalPos.room } });
    });
    out.push(...this.drainSample(colony));
    return out;
  }

  /** #40/ADR 0006's operation-owned observation history: a `{tick, towerEnergy, storageEnergy}` sample
   * whenever the target room has vision this tick — visibleRooms is the authoritative vision signal (not
   * hostileRoomTowers' presence, which is also empty for a genuinely visible-but-towerless room and would
   * wrongly read as "no vision"). towerEnergy/storageEnergy each default to 0 when their own map has no
   * entry for the target (towerless room / no storage structure, respectively) — vision is what gates
   * whether a sample is taken at all, not whether either quantity happens to be present. No sample, no
   * intent, when the target room isn't visible this tick — a gap in the history, not a zero-filled entry. */
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

/** The attacker when alive and present in the squad; otherwise a deterministic pick (alphabetically-first
 * by name) among alive healers — ADR 0006's leader-selection rule. `attacker` is undefined only when
 * intents() has already confirmed the squad is fully assembled, so a healer fallback here always has at
 * least DRAIN_HEALER_COUNT candidates. */
export function leaderOf(attacker: SnapCreep | undefined, healers: readonly SnapCreep[]): SnapCreep {
  if (attacker) return attacker;
  return [...healers].sort((a, b) => a.name.localeCompare(b.name))[0];
}

/** A healer's live HEAL part count. Unboosted — unlike SnapUnit.healParts (built for hostiles/wounded
 * friendlies, where boost-weighting matters for realistic combat math), SnapCreep carries no per-part
 * boost data at all today, so this is the best available signal; a boosted drain healer would undercount
 * here, a gap worth revisiting if/when boost support is added to SnapCreep generally. */
function healPartsOf(creep: SnapCreep): number {
  return creep.body.filter(p => p === HEAL).length;
}
