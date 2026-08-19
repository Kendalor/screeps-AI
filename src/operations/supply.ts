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

// Same RCL gate as the body split (behaviors/roles/supply.ts): two smaller creeps replace the one
// full-size one at the point their bodies actually shrink, not before.
function wantedSupply(colony: ColonySnapshot): number {
  return colony.controllerLevel >= supplyBodyConfig.twoSupplyRcl ? 2 : 1;
}

// Whether the sole survivor is close enough to death that its replacement must be spawning
// already — spawn time is body-length-dependent, so a late request leaves a gap after it dies.
function needsHandoff(creeps: readonly SnapCreep[], body: BodyPartConstant[]): boolean {
  if (creeps.length !== 1) return false; // one-in, one-out only — quota shortfalls take the branch above
  const left = creeps[0].ticksToLive;
  return left !== undefined && left <= body.length * CREEP_SPAWN_TIME;
}

export class Supply extends Operation {
  public readonly kind = "supply";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    const wanted = wantedSupply(colony);
    if (wanted === 0) return [];

    const have = this.owned(colony, "supply");
    const def = roleDef("supply")!;

    // Nothing alive yet: size off what the room can afford right now, not full capacity — waiting
    // for capacity-sized energy here is exactly the stall that starves extensions in the meantime.
    const energyForBody = have.length === 0 ? colony.energyAvailable : colony.energyCapacity;
    const body = orderBody(def.body(energyForBody, bodyContext(colony)));
    if (body.length === 0) return [];

    const missing = wanted - have.length;
    const requestCount = missing > 0 ? missing : needsHandoff(have, body) ? 1 : 0;
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
