// Scouting owns the empire's vision: it fields scouts to survey the rooms around a colony so remote
// mining and expansion have data to decide on. It is the port of legacy's OperationScoutingManager,
// reduced to the rewrite's shape — no persisted todo ledger, no pause/wakeup scheduler. The "what
// rooms exist near me" graph is walked once at the snapshot boundary (colony.scoutTargets); this
// operation reads it as plain data, decides which are stale, and sizes the scout fleet.
//
// Pure — reads the snapshot, returns plain data, never touches Game.*/Memory. Per-scout target
// assignment is NOT here: a scout picks the nearest unscouted room itself (empire/creeps.ts), so the
// operation only decides *how many* scouts to field, not where each goes.

import type { ColonySnapshot, ScoutCandidate } from "../snapshot/types";
import type { RoomType } from "../lib/roomName";
import { DEFAULT_PRIORITY, fillTo, type CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

// Re-survey intervals per room type, in ticks. A normal room's controller/sources barely change, so
// its data is good for a long time; a highway carries only transient rare resources (power banks,
// deposits) and must be re-checked often to catch them before they decay. Ported from legacy
// RoomMemoryUtil's SCOUTING_INTERVALL constants.
const STALE_AFTER: Record<RoomType, number> = {
  normal: 100000,
  keeper: 200000,
  highway: 3000,
  intersection: 3000
};

// One scout covers roughly this many rooms of frontier — the fleet is sized ceil(todo / this),
// legacy's ratio. Below this, a single scout suffices however large the ring.
const ROOMS_PER_SCOUT = 10;

// A hard ceiling so a vast frontier never drowns the spawn queue in scouts. Legacy capped the count
// at the number of owned rooms; a single colony's own cap is a small constant.
const MAX_SCOUTS = 3;

// A scout only walks — a lone MOVE part is the whole body. No WORK, no CARRY: it never harvests,
// builds, or carries; it exists to put vision in a room. The cheapest possible creep.
const SCOUT_BODY: BodyPartConstant[] = [MOVE];

/** The re-survey interval for a room type, exposed so the scout behaviour and tests agree with the
 * operation on what "stale" means. */
export function staleAfter(type: RoomType): number {
  return STALE_AFTER[type];
}

/**
 * Whether a candidate room is worth a scout's visit right now: true if it was never observed, or its
 * last observation is older than its type's re-survey interval. `now` is passed explicitly (the
 * snapshot's tick) so the decision is pure and unit-testable without Game.time.
 */
export function needsScouting(candidate: ScoutCandidate, now = 0): boolean {
  const info = candidate.info;
  if (!info || info.tick === undefined) return true; // never physically seen
  return now - info.tick >= staleAfter(candidate.type);
}

export class Scouting extends Operation {
  public readonly kind = "scouting";

  /**
   * Scout demand: one MOVE creep per ~ROOMS_PER_SCOUT rooms of unscouted frontier, capped at
   * MAX_SCOUTS, minus the scouts this operation already owns. Zero when every reachable room is
   * fresh — the frontier is fully surveyed and the fleet is allowed to die off by attrition until
   * an observation goes stale and re-opens demand.
   *
   * The count is a headcount, not a per-target deficit: which room each scout walks to is the
   * scout's own decision (nearest unscouted), so the operation sizes the fleet and no more. Legacy's
   * ceil(todo/10) ratio, its per-colony cap made a small constant.
   */
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    const todo = colony.scoutTargets.filter(t => needsScouting(t, colony.tick));
    if (todo.length === 0) return [];

    const wanted = Math.min(MAX_SCOUTS, Math.ceil(todo.length / ROOMS_PER_SCOUT));
    return fillTo(wanted, this.owned(colony, "scout").length, SCOUT_BODY, DEFAULT_PRIORITY.scout, {
      role: "scout",
      home: colony.name,
      op: this.name
    });
  }
}
