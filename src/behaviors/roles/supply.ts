import { haulerBody } from "./hauler";
import { Role } from "./role";

// A Logistics-owned mover, same as Transport: assignment comes from planLogistics via memory.logistics
// (restricted to spawn/extension/tower sinks and non-remote sources — see logistics/graph.ts's
// supplyProviders/supplyConsumers), not a static step table — steps stays empty so runCreepBehaviors()
// diverts it to empire/creeps.ts's transport runner instead of the step-table dispatch.
export class Supply extends Role {
  // Strictly above transport (100): a starved spawn stalls the whole colony, and supply is what
  // refills extensions from storage so bigger bodies (miners/haulers sized off capacity) ever become
  // affordable. Was tied with transport at 100, broken only by operations/index.ts's array order —
  // that silently starved supply outright (not just in the brief RCL3 crossover it was meant for)
  // whenever transport wanted a creep the same tick, since a single-spawn room's stable sort let
  // transport claim the only idle slot every time. See git history for the incident.
  static override readonly priority = 101;
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return haulerBody(energy);
  }
}
