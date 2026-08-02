import { haulerBody } from "./hauler";
import { Role } from "./role";

// A Logistics-owned mover, same as Transport: assignment comes from planLogistics via memory.logistics
// (restricted to spawn/extension/tower sinks and non-remote sources — see logistics/graph.ts's
// supplyProviders/supplyConsumers), not a static step table — steps stays empty so runCreepBehaviors()
// diverts it to empire/creeps.ts's transport runner instead of the step-table dispatch.
export class Supply extends Role {
  static override readonly priority = 100; // highest non-recovery priority: a starved spawn stalls the whole colony, and supply is what refills extensions from storage so bigger bodies (miners/haulers sized off capacity) ever become affordable
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return haulerBody(energy);
  }
}
