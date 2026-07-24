// Building owns the construction workforce: the builders that service outstanding sites.
// Demand only — its creeps run the builder role's step loop, and it places no structures
// and takes no direct action.
//
// Pure — reads the snapshot, returns plain requests, never touches Game.*.

import type { ColonySnapshot } from "../snapshot/types";
import { DEFAULT_PRIORITY, type CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

// One builder per this much outstanding work. No cap — like upgraders, builders are a sink for
// energy that would otherwise rot, and construction is a finite backlog (unlike the controller).
//
// The pre-storage figure is small on purpose: builders are tiny then (a 300-capacity body carries
// 50 energy) and throughput is trip-bound, not backlog-bound — two builders finishing *zero*
// extensions in 1500 ticks was measured, since a handful of 50-energy deliveries can't fill a
// 3000-energy extension while every other role competes for the same drops. Many small builders in
// parallel is the only way to finish an extension before storage exists, which is what unblocks the
// whole economy. Post-storage a builder withdraws a full load per trip, so far fewer are needed.
const PROGRESS_PER_BUILDER_PRE_STORAGE = 1_500;
const PROGRESS_PER_BUILDER = 5_000;

// Builders scale with the construction backlog, no storage gate: the builder role sources energy
// pre-storage too (drop pickup, then mining container, then a harvest fallback), so it needs no
// storage to work.
function wantedBuilders(colony: ColonySnapshot): number {
  if (colony.constructionProgress <= 0) return 0;
  const per = colony.storageEnergy > 0 ? PROGRESS_PER_BUILDER : PROGRESS_PER_BUILDER_PRE_STORAGE;
  return Math.ceil(colony.constructionProgress / per);
}

export class Building extends Operation {
  public readonly kind = "building";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.fillRole(colony, "builder", wantedBuilders(colony), DEFAULT_PRIORITY.builder);
  }
}
