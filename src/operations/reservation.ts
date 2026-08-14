// Reservation owns claimers, and only claimers — keeping Mining about miners+containers (the user's
// explicit split). One claimer per remote *room* (never per source): reserving a controller lifts every
// mined source in that room from 5 to 10 energy/tick at once. Pure — reads the snapshot's remoteSources
// (already grouped-able by room) and returns claimer demand; execute.ts spawns and moveToRoom walks them.

import { roleDef } from "../behaviors/roles";
import { CLAIMER_MIN_COST } from "../behaviors/roles/claimer";
import { log } from "../lib/log";
import { defaultEconomyContext, worthReserving } from "../mining/remoteEconomics";
import { INVADER_USERNAME } from "../mining/remoteSources";
import type { ColonySnapshot, SnapRemoteSource } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import { bodyContext } from "../spawn/bodyContext";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

export class Reservation extends Operation {
  public readonly kind = "reservation";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    // Affordability gate: no point requesting a claimer the home room can never spawn (CLAIM is 600).
    if (colony.energyCapacity < CLAIMER_MIN_COST) return [];

    const ctx = defaultEconomyContext();
    const claimers = this.owned(colony, "claimer");
    const body = orderBody(roleDef("claimer")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);

    const out: CreepRequest[] = [];
    for (const [room, sources] of this.byRoom(colony.remoteSources)) {
      // A hostile room, or one already reserved by another PLAYER, stops reserving (age-out, not retreat).
      // reservedBy excludes our own reservation by construction (see remoteRoomVision) — a claimer we
      // sent must not read as "someone else reserved this." An Invader-core reservation is deliberately
      // NOT a stop condition here: unlike a player's reservation (which claimController/reserveController
      // both reject outright), reserveController contests an Invader reservation just fine, ticking it
      // down same as a fresh room — so a claimer sent at an invader-held room competes for it instead of
      // sitting out.
      if (sources.some(s => s.danger > 0 || (s.reservedBy !== undefined && s.reservedBy !== INVADER_USERNAME))) {
        const blocker = sources.find(s => s.danger > 0 || s.reservedBy !== undefined);
        log.debugRoom(
          colony.name,
          `reservation skip ${room}: ${blocker?.danger ? "danger" : `reservedBy=${blocker?.reservedBy}`}`
        );
        continue;
      }
      if (!worthReserving(sources, ctx)) {
        log.debugRoom(colony.name, `reservation skip ${room}: not worth reserving (${sources.length} source(s))`);
        continue;
      }
      // One claimer per room: skip if this operation already has one aimed at this room.
      if (claimers.some(c => c.memory.targetRoom === room)) continue;

      out.push({
        body,
        priority: roleDef("claimer")!.priority,
        memory: { role: "claimer", home: colony.name, op: this.name },
        targetRoom: room,
        // Pinned to this colony — only the ONE colony that selected this remote ever requests a
        // claimer for it. See mining.ts's own spawnRoom pin (same reasoning) and fillTo's doc in
        // spawn/request.ts for the fuller explanation of why this matters.
        spawnRoom: colony.name
      });
    }
    return out;
  }

  /** Group the flat remote-source list by the room each source lives in. */
  private byRoom(sources: readonly SnapRemoteSource[]): Map<string, SnapRemoteSource[]> {
    const out = new Map<string, SnapRemoteSource[]>();
    for (const s of sources) {
      const list = out.get(s.room);
      if (list) list.push(s);
      else out.set(s.room, [s]);
    }
    return out;
  }
}
