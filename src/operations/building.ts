// Building owns the construction workforce: builders that service outstanding sites. Demand only, pure.

import { countPart } from "../spawn/body";
import { bodyContext } from "../spawn/bodyContext";
import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation, type RoleTarget } from "./operation";

const config = {
  // One WORK part per this much outstanding work — headcount falls out of dividing by a body's WORK
  // count, not from a fixed progress-per-creep figure. Uncapped in WORK, but never more than
  // maxBuilders creeps: a handful of well-bodied builders beat a swarm of small ones once storage exists.
  progressPerWork: 1_000,
  maxBuilders: 6
} as const;

function builderBodyWork(colony: ColonySnapshot): number {
  const body = roleDef("builder")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

// WORK needed to clear outstanding progress, translated into a creep headcount against the current
// body's WORK-per-creep, then capped at maxBuilders — never a raw headcount off progress directly.
function wantedBuilders(colony: ColonySnapshot): number {
  if (colony.constructionProgress <= 0) return 0;
  const wantedWork = Math.ceil(colony.constructionProgress / config.progressPerWork);
  const bodies = Math.ceil(wantedWork / builderBodyWork(colony));
  return Math.min(config.maxBuilders, bodies);
}

export class Building extends Operation {
  public readonly kind = "building";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.fillRole(colony, "builder", wantedBuilders(colony), roleDef("builder")!.priority);
  }

  /** Report the true builder target (0 once construction is done), so census shows any surplus as `N/0`. */
  public override roleTargets(colony: ColonySnapshot): RoleTarget[] {
    return [{ role: "builder", target: wantedBuilders(colony) }];
  }
}
