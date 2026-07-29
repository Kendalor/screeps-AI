// Reservation owns claimers, and only claimers — keeping Mining about miners+containers (the user's
// explicit split). One claimer per remote *room* (never per source): reserving a controller lifts every
// mined source in that room from 5 to 10 energy/tick at once. Pure — reads the snapshot's remoteSources
// (already grouped-able by room) and returns claimer demand; execute.ts spawns and moveToRoom walks them.

import { roleDef } from "../behaviors/roles";
import { CLAIMER_MIN_COST } from "../behaviors/roles/claimer";
import { defaultEconomyContext, worthReserving } from "../mining/remoteEconomics";
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
      if (sources.some(s => s.danger > 0)) continue; // a hostile room stops reserving (age-out, not retreat)
      if (!worthReserving(sources, ctx)) continue; // summed marginal 5/tick must beat one claimer's upkeep
      // One claimer per room: skip if this operation already has one aimed at this room.
      if (claimers.some(c => c.memory.targetRoom === room)) continue;

      out.push({
        body,
        priority: roleDef("claimer")!.priority,
        memory: { role: "claimer", home: colony.name, op: this.name },
        targetRoom: room
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
