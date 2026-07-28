// Logistics owns the transport-creep headcount and per-tick task assignment for the provider/consumer
// graph in src/logistics/. Additive alongside Mining's hauler and Supply — see docs/logistics-plan.md
// for the full rollout: this starts on jobs neither already covers well (controller-container top-off),
// not the source->spawn leg hauler.ts still owns.

import type { Intent } from "../intents/types";
import { planLogistics } from "../logistics";
import { providers, consumers } from "../logistics/graph";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";
import { roleDef } from "../behaviors/roles";

const config = {
  wanted: 1 // conservative fixed quota — not sized to replace hauler/supply capacity yet (plan step 4)
} as const;

export class Logistics extends Operation {
  public readonly kind = "logistics";

  // No provider or consumer yet (e.g. a fresh RCL1 colony with no containers/drops/spawn deficit)
  // means nothing for a transport creep to do — asking anyway would outrank upgrader for a spawn slot
  // on a job that doesn't exist, the same silent-stall shape Supply avoids by gating on storageEnergy.
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    if (providers(colony).length === 0 || consumers(colony).length === 0) return [];
    return this.fillRole(colony, "transport", config.wanted, roleDef("transport")!.priority);
  }

  /** Direct action, not arbitrated: runs planLogistics once per tick and emits one assignment intent per idle creep. */
  public override intents(colony: ColonySnapshot): Intent[] {
    const plan = planLogistics(colony);
    return Object.entries(plan.assignments).map(([creep, task]) => ({
      kind: "assignLogisticsTask",
      creep: creep as Id<Creep>,
      task
    }));
  }
}
