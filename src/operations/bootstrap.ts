// Bootstrap owns recovery from a total colony wipe — nothing else. Pure — reads the snapshot, returns plain requests.

import { bodyCost, orderBody } from "../spawn/body";
import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";
import { RECOVERY_PRIORITY, opName, type CreepRequest } from "../spawn/request";
import { bodyContext } from "../spawn/bodyContext";
import { Operation } from "./operation";

// Detects total creep loss directly (zero count), since normal quotas evaluate to zero forever otherwise.
function recoveryRequests(colony: ColonySnapshot): CreepRequest[] {
  if (colony.creeps.length > 0) return [];

  // Supply withdraws storage into extensions; bootstrap needs a source instead.
  const role = colony.storageEnergy > 0 ? "supply" : colony.sources.length > 0 ? "bootstrap" : undefined;
  if (!role) return [];

  const def = roleDef(role);
  if (!def) return [];

  // Sized against energyAvailable, not capacity: no creep exists yet to fill extensions further.
  const body = orderBody(def.body(colony.energyAvailable, bodyContext(colony)));
  if (body.length === 0) return [];

  // Withhold rather than emit an unaffordable body: at RECOVERY_PRIORITY it would block everything behind it.
  if (bodyCost(body) > colony.energyAvailable) return [];

  return [
    {
      body,
      priority: RECOVERY_PRIORITY,
      memory: { role, home: colony.name, op: opName("recovery", colony.name) },
      targetRoom: colony.name
      // No spawnRoom pin, unlike every other colony-scoped request (see spawn/request.ts's fillTo doc)
      // — deliberately kept: a wiped colony with a busy/full spawn of its own is exactly the case where
      // losing extra ticks matters most, so recovery alone keeps the old cross-colony fallback (the
      // nearest OTHER colony's spawn serves it if its own can't) rather than simply waiting.
    }
  ];
}

export class Bootstrap extends Operation {
  public readonly kind = "bootstrap";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return recoveryRequests(colony);
  }
}
