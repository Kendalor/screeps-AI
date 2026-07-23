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

// One builder per 5k of outstanding work, never more than 3 — an uncapped quota would starve every other role of spawn capacity.
const PROGRESS_PER_BUILDER = 5_000;
const MAX_BUILDERS = 3;

// Builders scale with the construction backlog alone. The old storage gate is gone: it existed
// because bootstrap used to build via its own step loop pre-storage, so a dedicated builder then
// would double-staff. With bootstrap's early-game workforce removed, builders *are* how sites get
// finished from the first construction site on — and the builder role sources energy pre-storage
// (drop pickup, then mining container, then a harvest fallback), so it needs no storage to work.
function wantedBuilders(colony: ColonySnapshot): number {
  if (colony.constructionProgress <= 0) return 0;
  return Math.min(MAX_BUILDERS, Math.ceil(colony.constructionProgress / PROGRESS_PER_BUILDER));
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
