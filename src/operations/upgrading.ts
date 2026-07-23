// Upgrading owns the upgrader workforce: how many upgraders the colony should field given its
// stored energy. Demand only — its creeps run the upgrade role's step loop, and it places no
// structures and takes no direct action. The quota is ported verbatim from systems/upgrading.ts.
//
// Pure — reads the snapshot, returns plain requests, never touches Game.*.

import { orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";
import { DEFAULT_PRIORITY, fillTo, type CreepRequest } from "../spawn/request";
import { bodyContext } from "../behaviors/bodyContext";
import { Operation } from "./operation";

// Below this, storage is reserved for other spending; above it, one extra upgrader per 40k stored.
const STORAGE_RESERVE = 100_000;
const STORAGE_PER_UPGRADER = 40_000;
const MAX_STORAGE_UPGRADERS = 4;

function wantedUpgraders(colony: ColonySnapshot): number {
  // The upgrader role has no harvest step, so without storage/link to withdraw from it just wanders inert.
  if (colony.storageEnergy <= 0) return 0;
  return Math.min(
    MAX_STORAGE_UPGRADERS,
    Math.max(0, Math.floor((colony.storageEnergy - STORAGE_RESERVE) / STORAGE_PER_UPGRADER))
  );
}

export class Upgrading extends Operation {
  public readonly kind = "upgrading";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return fillTo(
      wantedUpgraders(colony),
      colony.creeps.filter(c => c.role === "upgrader").length,
      orderBody(roleDef("upgrader")?.body(colony.energyCapacity, bodyContext(colony)) ?? []),
      DEFAULT_PRIORITY.upgrader,
      { role: "upgrader", home: colony.name, op: this.name }
    );
  }
}
