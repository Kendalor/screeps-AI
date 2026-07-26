// Scouting fields scouts to survey rooms around a colony so remote mining/expansion has data to decide on.
// Pure — reads the snapshot, returns intents (recordScout, setScoutTarget); execute.ts does the live-room read, route computation, and walking.

import { roleDef } from "../behaviors/roles";
import { needsPassiveRecording, needsScouting, pickScoutTarget } from "../behaviors/scout";
import type { Intent } from "../intents/types";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

// Staleness rules live in the behaviour's pure core (shared with the target picker); re-exported for callers/tests.
export { needsScouting, staleAfter } from "../behaviors/scout";

const config = {
  roomsPerScout: 10, // fleet size is ceil(todo / this)
  maxScouts: 3 // hard ceiling so a vast frontier never drowns the spawn queue
} as const;

export class Scouting extends Operation {
  public readonly kind = "scouting";

  /** Scout demand: one per ~roomsPerScout rooms of stale frontier, capped at maxScouts; zero when everything is fresh. */
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    // The home room (distance 0) is never dispatch-worthy — it's covered by passive recording, not a scout trip.
    const todo = colony.scoutTargets.filter(t => t.room !== colony.name && needsScouting(t, colony.tick));
    if (todo.length === 0) return [];

    const wanted = Math.min(config.maxScouts, Math.ceil(todo.length / config.roomsPerScout));
    return this.fillRole(colony, "scout", wanted, roleDef("scout")!.priority);
  }

  /** Per scout: emit recordScout if standing in a room that needs surveying, and/or setScoutTarget if it needs a new destination.
   * Also passively records any other currently-visible room (visibleRooms) whose record has gone stale
   * by the tighter passive interval — ambient vision from any creep/structure, not just an assigned scout. */
  public override intents(colony: ColonySnapshot): Intent[] {
    const scouts = this.owned(colony, "scout");
    const recorded = new Set<string>();
    const out: Intent[] = [];
    for (const scout of scouts) {
      if (this.shouldRecord(colony, scout)) {
        out.push({ kind: "recordScout", room: scout.room });
        recorded.add(scout.room);
      }

      const target = this.nextTargetFor(colony, scout);
      if (target) out.push({ kind: "setScoutTarget", creep: scout.id, targetRoom: target });
    }

    for (const visible of colony.visibleRooms) {
      if (recorded.has(visible.room)) continue; // already covered by the active pass above this tick
      if (!needsPassiveRecording(visible.info, colony.tick)) continue;
      out.push({ kind: "recordScout", room: visible.room, passive: true });
    }

    // Nothing left in range to survey — push the frontier out one ring (execute.ts caps at MAX_SCOUT_RANGE).
    // Home room excluded: it's never dispatch-worthy, so it must not block the frontier from advancing.
    const nothingToDo =
      scouts.length > 0 && !colony.scoutTargets.some(t => t.room !== colony.name && needsScouting(t, colony.tick));
    if (nothingToDo) out.push({ kind: "advanceScoutRadius" });

    return out;
  }

  // Worth recording if the scout's current room is a frontier room whose observation is missing or stale.
  private shouldRecord(colony: ColonySnapshot, scout: SnapCreep): boolean {
    const candidate = colony.scoutTargets.find(t => t.room === scout.room);
    return candidate !== undefined && needsScouting(candidate, colony.tick);
  }

  // The room to (re)assign, or undefined to leave it travelling (mid-route reassignment would thrash the route).
  private nextTargetFor(colony: ColonySnapshot, scout: SnapCreep): string | undefined {
    const assigned = scout.memory.scoutTarget;
    const stillTravelling = assigned !== undefined && assigned !== scout.room;
    if (stillTravelling) return undefined;
    // Exclude the room the scout stands in (recorded this tick, not re-targeted) and the colony's own
    // home room: it's a scoutTargets entry (distance 0) for passive-recording purposes only, and
    // already has permanent vision, so a scout must never be dispatched to sit in it.
    const elsewhere = colony.scoutTargets.filter(t => t.room !== scout.room && t.room !== colony.name);
    return pickScoutTarget(elsewhere, scout.room, colony.tick, scout.memory.lastRoom);
  }
}
