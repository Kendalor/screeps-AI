// Building owns the construction workforce: the builders that service outstanding sites.
// Demand only — its creeps run the builder role's step loop, and it places no structures
// and takes no direct action.
//
// Pure — reads the snapshot, returns plain requests, never touches Game.*.

import { orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";
import { DEFAULT_PRIORITY, fillTo, type CreepRequest } from "../spawn/request";
import { bodyContext } from "../behaviors/bodyContext";
import { Operation } from "./operation";

// One builder per this much outstanding work. Cap removed — like upgraders, builders are a sink for
// energy that would otherwise rot, and construction is a finite backlog (unlike the controller).
//
// The figure is small pre-storage on purpose. There, builders are tiny (a 300-capacity body carries
// 50 energy) and throughput is trip-bound, not backlog-bound: two builders finishing *zero*
// extensions in 1500 ticks was measured, because a handful of 50-energy deliveries cannot fill a
// 3000-energy extension while every other role competes for the same drops. Many small builders in
// parallel is the only way to complete an extension before storage exists — and completing one is
// what lets every future body grow past 300, which unblocks the whole economy. Post-storage a builder
// withdraws a full load per trip, so the backlog-bound figure applies and far fewer are needed.
const PROGRESS_PER_BUILDER_PRE_STORAGE = 1_500;
const PROGRESS_PER_BUILDER = 5_000;

// Builders scale with the construction backlog. The old storage gate is gone: it existed because
// bootstrap used to build via its own step loop pre-storage, so a dedicated builder then would
// double-staff. With bootstrap's early-game workforce removed, builders *are* how sites get finished
// from the first one on — and the builder role sources energy pre-storage (drop pickup, then mining
// container, then a harvest fallback), so it needs no storage to work.
function wantedBuilders(colony: ColonySnapshot): number {
  if (colony.constructionProgress <= 0) return 0;
  const per = colony.storageEnergy > 0 ? PROGRESS_PER_BUILDER : PROGRESS_PER_BUILDER_PRE_STORAGE;
  return Math.ceil(colony.constructionProgress / per);
}

export class Building extends Operation {
  public readonly kind = "building";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return fillTo(
      wantedBuilders(colony),
      this.owned(colony, "builder").length,
      orderBody(roleDef("builder")?.body(colony.energyCapacity, bodyContext(colony)) ?? []),
      DEFAULT_PRIORITY.builder,
      { role: "builder", home: colony.name, op: this.name }
    );
  }
}
