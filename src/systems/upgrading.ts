import { orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { Colony } from "../colony";
import { DEFAULT_PRIORITY, fillTo, opName, type CreepRequest } from "../spawn/request";
import type { ColonySnapshot } from "../snapshot/types";
import { bodyContext } from "./spawnContext";

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

export function upgraderRequests({ snapshot: colony }: Colony): CreepRequest[] {
  return fillTo(
    wantedUpgraders(colony),
    colony.creeps.filter(c => c.role === "upgrader").length,
    orderBody(roleDef("upgrader")?.body(colony.energyCapacity, bodyContext(colony)) ?? []),
    DEFAULT_PRIORITY.upgrader,
    { role: "upgrader", home: colony.name, op: opName("upgrading", colony.name) }
  );
}
