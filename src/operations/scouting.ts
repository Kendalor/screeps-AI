// Scouting owns the empire's vision: it fields scouts to survey the rooms around a colony so remote
// mining and expansion have data to decide on. It is the port of legacy's OperationScoutingManager,
// reduced to the rewrite's shape — no persisted todo ledger, no pause/wakeup scheduler. The "what
// rooms exist near me" graph is walked once at the snapshot boundary (colony.scoutTargets); this
// operation reads it as plain data, decides which are stale, and sizes the scout fleet.
//
// Pure — reads the snapshot, returns plain data, never touches Game.*/Memory. It drives its scouts
// entirely through intents (recordScout, setScoutTarget), the same plan/execute split every other
// operation uses: execute.ts does the live-room read and the route computation, the moveToRoom
// behaviour does the walking. This operation only *decides* — how many scouts, and which room each
// records or heads for next.

import { needsScouting, pickScoutTarget } from "../behaviors/scout";
import type { Intent } from "../intents/types";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import { DEFAULT_PRIORITY, fillTo, type CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

// The staleness rules live in the behaviour's pure core (shared with the target picker); re-exported
// here so callers and tests that think in terms of the operation still reach them from one place.
export { needsScouting, staleAfter } from "../behaviors/scout";

// One scout covers roughly this many rooms of frontier — the fleet is sized ceil(todo / this),
// legacy's ratio. Below this, a single scout suffices however large the ring.
const ROOMS_PER_SCOUT = 10;

// A hard ceiling so a vast frontier never drowns the spawn queue in scouts. Legacy capped the count
// at the number of owned rooms; a single colony's own cap is a small constant.
const MAX_SCOUTS = 3;

// A scout only walks — a lone MOVE part is the whole body. No WORK, no CARRY: it never harvests,
// builds, or carries; it exists to put vision in a room. The cheapest possible creep.
const SCOUT_BODY: BodyPartConstant[] = [MOVE];

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

  /**
   * Drives this operation's scouts through intents, the same plan/execute split every other
   * operation uses: it never moves a creep or writes memory itself. Per owned scout, per tick:
   *
   *  - if the scout stands in a room that still needs surveying, emit `recordScout` — execute.ts
   *    reads the live room and writes the observation;
   *  - if the scout has no target, or has reached the one it had, emit `setScoutTarget` with the
   *    nearest unscouted room — execute.ts computes the route and writes it into memory.
   *
   * A scout still travelling to an unreached target gets neither intent: it is left to walk. The
   * movement itself is the moveToRoom behaviour, which reads the target this assigns.
   */
  public override intents(colony: ColonySnapshot): Intent[] {
    const scouts = this.owned(colony, "scout");
    const out: Intent[] = [];
    for (const scout of scouts) {
      if (this.shouldRecord(colony, scout)) out.push({ kind: "recordScout", room: scout.room });

      const target = this.nextTargetFor(colony, scout);
      if (target) out.push({ kind: "setScoutTarget", creep: scout.id, targetRoom: target });
    }

    // The scouts have nothing left in range to survey — push the frontier out one ring so next
    // tick's snapshot reaches farther. Only with scouts alive to use the wider radius, and only when
    // the current ring is genuinely exhausted (no target was assignable above), so it grows once per
    // exhausted ring rather than every idle tick. execute.ts caps it at MAX_SCOUT_RANGE.
    const nothingToDo = scouts.length > 0 && !colony.scoutTargets.some(t => needsScouting(t, colony.tick));
    if (nothingToDo) out.push({ kind: "advanceScoutRadius" });

    return out;
  }

  // The scout's current room is worth recording if scouting still wants it — i.e. it is a frontier
  // room (in scoutTargets) whose observation is missing or stale. A scout sitting in its home colony
  // or a room off the frontier records nothing.
  private shouldRecord(colony: ColonySnapshot, scout: SnapCreep): boolean {
    const candidate = colony.scoutTargets.find(t => t.room === scout.room);
    return candidate !== undefined && needsScouting(candidate, colony.tick);
  }

  // The room to (re)assign this scout, or undefined to leave it travelling. A scout needs a new
  // target when it has none, or when it has arrived at the one it had (standing in it). Otherwise it
  // is mid-route and must not be disturbed, or the reassignment would thrash its route every tick.
  private nextTargetFor(colony: ColonySnapshot, scout: SnapCreep): string | undefined {
    const assigned = scout.memory.scoutTarget;
    const stillTravelling = assigned !== undefined && assigned !== scout.room;
    if (stillTravelling) return undefined;
    // Exclude the room the scout already stands in: it is being recorded this tick (shouldRecord), so
    // re-targeting it would send the scout nowhere and rewrite its route for a zero-length trip.
    const elsewhere = colony.scoutTargets.filter(t => t.room !== scout.room);
    return pickScoutTarget(elsewhere, scout.room, colony.tick);
  }
}
