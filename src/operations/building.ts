// Building owns the construction workforce: builders that service outstanding sites. Demand only, pure.

import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

const config = {
  // One builder per this much outstanding work, uncapped. Pre-storage figure is small: tiny bodies
  // and trip-bound throughput mean many small builders in parallel are needed to finish anything.
  progressPerBuilderPreStorage: 1_500,
  progressPerBuilder: 5_000
} as const;

// No storage gate: the builder role sources energy pre-storage too (drop/container/harvest fallback).
function wantedBuilders(colony: ColonySnapshot): number {
  if (colony.constructionProgress <= 0) return 0;
  const per = colony.storageEnergy > 0 ? config.progressPerBuilder : config.progressPerBuilderPreStorage;
  return Math.ceil(colony.constructionProgress / per);
}

export class Building extends Operation {
  public readonly kind = "building";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.fillRole(colony, "builder", wantedBuilders(colony), roleDef("builder")!.priority);
  }
}
