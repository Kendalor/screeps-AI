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
  maxBuilders: 6,

  // build() costs 5 energy/tick per WORK part (BUILD_POWER = 5), so a room's sustainable build
  // throughput is income / 5 WORK. Income here is the source-regen ceiling (sourceRegenPerTick shared
  // with mining.ts/logistics.ts): a room can't out-harvest its sources. Without storage this is the
  // real limit — over-spending just drains standing energy the haulers never refill. Builders win the
  // energy competition over upgraders (upgrading throttles to the remainder), so the whole income can
  // back building while a backlog exists.
  buildEnergyPerWork: 5,
  sourceRegenPerTick: 10
} as const;

/** Steady-state harvest ceiling: sources can't be out-mined, so income tops out at regen per source. */
export function incomePerTick(colony: ColonySnapshot): number {
  return colony.sources.length * config.sourceRegenPerTick;
}

/** Sustainable build WORK the room's income can feed: income / 5 e/t-per-WORK, floored. */
export function sustainableBuildWork(colony: ColonySnapshot): number {
  return Math.floor(incomePerTick(colony) / config.buildEnergyPerWork);
}

function builderBodyWork(colony: ColonySnapshot): number {
  const body = roleDef("builder")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

// WORK needed to clear outstanding progress, translated into a creep headcount against the current
// body's WORK-per-creep, then capped at maxBuilders — never a raw headcount off progress directly.
//
// Pre-storage the WORK is also capped at what income can sustainably feed (income / 5): without a
// buffer to draw down, extra builders just out-spend the haulers and stall on empty. With storage the
// cap lifts — a build blitz can spend the buffer down and refill afterwards, so the backlog drives it.
function wantedBuilders(colony: ColonySnapshot): number {
  if (colony.constructionProgress <= 0) return 0;
  let wantedWork = Math.ceil(colony.constructionProgress / config.progressPerWork);
  if (colony.storageEnergy <= 0) {
    wantedWork = Math.min(wantedWork, Math.max(1, sustainableBuildWork(colony)));
  }
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
