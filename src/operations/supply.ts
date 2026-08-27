// Supply owns keeping spawning structures (spawn/extensions/towers) topped off. Headcount only — task
// assignment is Supply's own self-registered pool as of gh #53 (logistics/supplyRegister.ts's
// registerSupplyRequests/pickSupplyRequest, run each tick by behaviors/supplyTaskRunner.ts's
// runSupplyTask, diverted to in empire/creeps.ts) — Supply itself carries no step table and emits no
// intents.

import { orderBody } from "../spawn/body";
import { bodyContext } from "../spawn/bodyContext";
import { roleDef } from "../behaviors/roles";
import { config as supplyBodyConfig } from "../behaviors/roles/supply";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

// Two supply creeps from RCL1 on: with Transport's new pool never touching spawn/extension (ADR 0008,
// gh #52 cutover), a single Supply creep is the room's ONLY mover for that whole sink set pre-storage —
// a real, measured throughput regression (RCL2 boot moved from ~779 to ~1160-1200 ticks, see that ADR's
// addendum). A second creep from the start covers this without waiting for supplyBodyConfig.twoSupplyRcl,
// which only ever gated the body-size split (one full-size hauler body vs. two half-size 2:1 CARRY:MOVE
// bodies) — headcount and body shape are independent knobs.
function wantedSupply(): number {
  return 2;
}

// Whether a survivor at quota is close enough to death that its replacement must be spawning
// already — spawn time is body-length-dependent, so a late request leaves a gap after it dies.
// Quota is 2, so this only needs to catch one dying at a time; if two die on the same tick, the
// shortfall branch above (missing > 0) already covers the second replacement the tick after.
function needsHandoff(creeps: readonly SnapCreep[], wanted: number, body: BodyPartConstant[]): boolean {
  if (creeps.length !== wanted) return false; // below quota already takes the shortfall branch above
  return creeps.some(c => c.ticksToLive !== undefined && c.ticksToLive <= body.length * CREEP_SPAWN_TIME);
}

export class Supply extends Operation {
  public readonly kind = "supply";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    const wanted = wantedSupply();
    const have = this.owned(colony, "supply");
    const def = roleDef("supply")!;

    // Nothing alive yet: size off what the room can afford right now, not full capacity — waiting
    // for capacity-sized energy here is exactly the stall that starves extensions in the meantime.
    const energyForBody = have.length === 0 ? colony.energyAvailable : colony.energyCapacity;
    const body = orderBody(def.body(energyForBody, bodyContext(colony)));
    if (body.length === 0) return [];

    const missing = wanted - have.length;
    const requestCount = missing > 0 ? missing : needsHandoff(have, wanted, body) ? 1 : 0;
    if (requestCount === 0) return [];

    return Array.from({ length: requestCount }, () => ({
      body: [...body],
      priority: def.priority,
      memory: { role: "supply", home: colony.name, op: this.name },
      targetRoom: colony.name,
      spawnRoom: colony.name
    }));
  }
}
