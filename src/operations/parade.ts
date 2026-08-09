// Parade: a marching formation that walks to wherever its flag currently sits and keeps following it as
// the player drags the flag around (see empire/paradeFlags.ts's header for why the flag itself, not a
// resolved target room, is the live destination). Movement is the generic Squad entity (src/lib/squad.ts)
// exactly like Drain (ADR 0007) — Parade supplies only the formation shape and the goal tile; there is no
// combat, no staging/advance-retreat, no action content at all (actionPlanner is a no-op).
//
// Unlike Drain's fixed 2x2 attacker+healer composition, Parade's squad size is a player-chosen SQUARE shape
// ("2x2", "3x3", ...) parsed once at flag-handoff time (ColonyMemory.parading.formation) into a plain
// square block (lib/formation.ts's parseRectFormation) filled entirely with one role, "paradeMember" —
// there's nothing to differentiate slots by, so every slot gets the same role string. Non-square shapes
// (e.g. "1x3") are rejected by parseRectFormation and fall back to DEFAULT_PARADE_FORMATION, since squad
// pathing requires every formation's bounding box to be square (see formation.ts's assertSquareTopLeftAnchor).

import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import { parseRectFormation, type Formation } from "../lib/formation";
import { worldOf, type XY } from "../lib/geometry";
import type { ActionIntent, SquadActionPlanner, SquadState } from "../lib/squad";
import type { OccupancySource, TerrainSource } from "../lib/squadPath";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

export const PARADE_MEMBER_ROLE = "paradeMember";
export const DEFAULT_PARADE_FORMATION = "2x2";

// The formation this parade is marching in, or the default shape if the stored string is somehow
// malformed (e.g. hand-edited memory) — never crashes on a bad shape string, just marches as 2x2.
export function paradeFormation(shape: string): Formation {
  return parseRectFormation(shape, PARADE_MEMBER_ROLE) ?? parseRectFormation(DEFAULT_PARADE_FORMATION, PARADE_MEMBER_ROLE)!;
}

export class Parade extends Operation {
  public readonly kind = "parade";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    if (!colony.parading) return [];
    const formation = paradeFormation(colony.parading.formation);
    const wanted = formation.length;
    const owned = this.owned(colony, PARADE_MEMBER_ROLE).length;
    const missing = wanted - owned;
    if (missing <= 0) return [];
    const def = roleDef(PARADE_MEMBER_ROLE);
    if (!def) return [];
    const body = orderBody(def.body(colony.energyCapacity, { hasContainer: false, hasLink: false }));
    if (body.length === 0) return [];
    return Array.from({ length: missing }, () => ({
      body,
      priority: def.priority,
      memory: { role: PARADE_MEMBER_ROLE, home: colony.name, op: this.name },
      targetRoom: colony.name,
      spawnRoom: colony.name
    }));
  }

  private squad(colony: ColonySnapshot): SnapCreep[] {
    return [...this.owned(colony, PARADE_MEMBER_ROLE)];
  }

  /** The squad's terrain source — paradeRoomTerrain covers the home room and the flag's current room,
   * recomputed every tick at the snapshot boundary since (unlike Drain's fixed route) the flag can jump
   * to any room the player drags it to. A room with no entry reads as fully walkable, same fail-open
   * convention every other TerrainSource consumer uses. */
  public terrain(colony: ColonySnapshot): TerrainSource {
    return room => colony.paradeRoomTerrain[room];
  }

  /** The squad's own tiles are cleared from the occupancy grid so it never blocks itself — same reasoning
   * as Drain.occupancy (see its doc in operations/drain.ts). */
  public occupancy(colony: ColonySnapshot): OccupancySource {
    const squad = this.squad(colony);
    return room => {
      const raw = colony.paradeRoomOccupancy[room];
      if (!raw) return undefined;
      const mine = squad.filter(c => c.room === room);
      if (mine.length === 0) return raw;
      const grid = raw.slice();
      for (const c of mine) grid[c.x * 50 + c.y] = 0;
      return grid;
    };
  }

  /** Wherever the flag currently sits — the squad's whole destination, re-read live every tick (see
   * ColonySnapshot.paradeGoal's doc). Undefined while there's no parade, no squad, or the flag has been
   * removed (paradeFlags.ts hasn't caught up yet to clear `parading` outright) — the squad simply holds in
   * place until one of those resolves. */
  public squadGoal(colony: ColonySnapshot): (XY & { room: string }) | undefined {
    if (!colony.parading || !colony.paradeGoal) return undefined;
    if (this.squad(colony).length === 0) return undefined;
    return colony.paradeGoal;
  }

  /** The SquadState the generic Squad entity runs this tick, or undefined while there's nothing to march.
   * Membership is STATEFUL (CreepMemory.squadJoined), same bootstrap-then-range-gated-re-entry rule Drain
   * uses (see Drain.squadState's doc in operations/drain.ts for the full rationale) — copied rather than
   * shared today (no generic join helper exists yet in lib/squad.ts), scoped to this operation's own name
   * so it can never collide with a different squad-bearing operation's membership. */
  public squadState(colony: ColonySnapshot): SquadState | undefined {
    if (!colony.parading || !colony.paradeGoal) return undefined;
    const squad = this.squad(colony);
    if (squad.length === 0) return undefined;

    const formation = paradeFormation(colony.parading.formation);
    const assembled = squad.length >= formation.length;
    // Ready to start marching once the whole formation is spawned and physically together at home — a
    // parade has no separate staging room (unlike Drain's hostile-target staging rule): home IS staging.
    const readyForFirstPush = assembled && squad.every(c => c.room === colony.name);
    // Already marching: some member stands outside the home room (or, if home is itself the goal room, is
    // already tight — checked via joined-state below, same as readyForFirstPush's role for Drain's
    // "underway" test). A parade whose flag never leaves the home room still needs to go squadded the
    // instant it's assembled, so "underway" here is simply "not still assembling."
    const underway = squad.some(c => c.room !== colony.name) || readyForFirstPush;
    if (!underway) return undefined;

    let joined = squad.filter(c => c.memory.squadJoined === this.name);
    if (joined.length === 0) {
      joined = squad;
    } else {
      const refRoom = mostCommonRoom(joined);
      const refPos = joined.find(c => c.room === refRoom) ?? joined[0];
      const refWorld = worldOf(refPos.x, refPos.y, refPos.room);
      const joinRadius = Math.max(...formation.map(s => Math.max(Math.abs(s.dx), Math.abs(s.dy))), 0);
      const rejoining = squad.filter(c => {
        if (c.memory.squadJoined === this.name) return false;
        const w = worldOf(c.x, c.y, c.room);
        return Math.max(Math.abs(w.wx - refWorld.wx), Math.abs(w.wy - refWorld.wy)) <= joinRadius;
      });
      if (rejoining.length > 0) joined = [...joined, ...rejoining];
    }
    if (joined.length === 0) return undefined;

    // THE anchor — a PERSISTED value (ColonyMemory.paradeAnchor, same rule as Drain's drainAnchor, see its
    // doc) read straight off the snapshot in steady state. Falls back to the live-position derivation only
    // when nothing is persisted yet (the very first tick this parade ever welds up, seeded this same tick
    // via setParadeAnchor below).
    const anchorMember = joined.find(c => c.room === mostCommonRoom(joined)) ?? joined[0];
    const anchor: XY & { room: string } = colony.paradeAnchor ?? { x: anchorMember.x, y: anchorMember.y, room: anchorMember.room };
    return { members: joined, formation, anchor };
  }

  // No combat content at all — a parade never attacks or heals, it only marches.
  public readonly actionPlanner: SquadActionPlanner = () => new Map<Id<Creep>, ActionIntent>();

  /** SquadBearingOperation's setSquadAnchor hook — identical rule to Drain.setSquadAnchor (see its doc in
   * operations/drain.ts). */
  public setSquadAnchor(colony: ColonySnapshot, anchor: XY & { room: string }): Intent[] {
    return [{ kind: "setParadeAnchor", room: colony.name, anchor }];
  }

  public override intents(colony: ColonySnapshot): Intent[] {
    const squad = this.squad(colony);
    const out: Intent[] = [];

    if (!colony.parading) {
      for (const c of squad) if (c.memory.squadJoined === this.name) out.push({ kind: "clearSquadJoined", creep: c.id });
      return out;
    }

    const state = this.squadState(colony);
    out.push(...this.joinIntents(squad, state));

    // Seed the persisted anchor (ColonyMemory.paradeAnchor) the moment a squad state first exists but
    // nothing is stored yet — same reasoning as Drain's intents() (see its doc in operations/drain.ts).
    if (state && !colony.paradeAnchor) {
      out.push({ kind: "setParadeAnchor", room: colony.name, anchor: state.anchor });
    }

    // Steer every unsquadded member toward a concrete tile — the squad's live anchor once one exists (a
    // replacement/straggler closing distance), else the home room's own anchor point pre-assembly. Same
    // reasoning as Drain's rally-pos steering: a room-name-only destination lets two stragglers chase each
    // other back and forth across a border forever.
    const squaddedIds = new Set(state?.members.map(m => m.id));
    const rallyPos: XY & { room: string } = state ? state.anchor : { x: 25, y: 25, room: colony.name };
    for (const c of squad) {
      if (squaddedIds.has(c.id)) continue;
      const current = c.memory.paradeRallyPos;
      if (!current || current.x !== rallyPos.x || current.y !== rallyPos.y || current.room !== rallyPos.room) {
        out.push({ kind: "setParadeRallyPos", creep: c.id, pos: rallyPos });
      }
    }

    return out;
  }

  /** Emits setSquadJoined for every squad member squadState just resolved into membership that doesn't
   * already carry the flag — the write side mirroring squadState's own read-side decision, same split
   * Drain.joinIntents uses (see its doc in operations/drain.ts). */
  private joinIntents(squad: readonly SnapCreep[], state: SquadState | undefined): Intent[] {
    if (!state) return [];
    const memberIds = new Set(state.members.map(m => m.id));
    return squad
      .filter(c => memberIds.has(c.id) && c.memory.squadJoined !== this.name)
      .map(c => ({ kind: "setSquadJoined", creep: c.id, op: this.name }));
  }
}

// The room most of the squad's members currently stand in — same rough "where's the squad" read Drain's
// mostCommonRoom uses for its own lower-stakes callers (re-entry join radius, anchor-reference room).
function mostCommonRoom(squad: readonly SnapCreep[]): string {
  const counts = new Map<string, number>();
  for (const c of squad) counts.set(c.room, (counts.get(c.room) ?? 0) + 1);
  let best = squad[0]?.room ?? "";
  let bestN = -1;
  for (const [room, n] of counts) if (n > bestN) [best, bestN] = [room, n];
  return best;
}

