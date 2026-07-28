// Repairing owns the dedicated repair workforce: decay no tower reaches — either because the colony
// has no tower yet, or the decayed structure sits beyond a tower's efficient repair range (remote
// infrastructure, or a bunker structure just outside range). Tower-covered decay is Defense's job.

import { roleDef } from "../behaviors/roles";
import { needsRepair } from "../lib/repairable";
import { coveredByTower } from "./defense";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation, type RoleTarget } from "./operation";

function wantedRepairers(colony: ColonySnapshot): number {
  const uncovered = colony.structures.some(
    s => s.hits !== undefined && s.hitsMax !== undefined && needsRepair(s.type, s.hits, s.hitsMax) && !coveredByTower(colony, s)
  );
  return uncovered ? 1 : 0;
}

export class Repairing extends Operation {
  public readonly kind = "repairing";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.fillRole(colony, "repair", wantedRepairers(colony), roleDef("repair")!.priority);
  }

  /** Report the true repairer target (0 once towers cover everything), so census shows any surplus as `N/0`. */
  public override roleTargets(colony: ColonySnapshot): RoleTarget[] {
    return [{ role: "repair", target: wantedRepairers(colony) }];
  }
}
