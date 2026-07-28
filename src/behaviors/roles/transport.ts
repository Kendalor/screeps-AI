import { haulerBody } from "./hauler";
import { Role } from "./role";

// A Logistics-owned mover: assignment comes from planLogistics via memory.logistics, not a static step
// table — steps stays empty so runCreepBehaviors() diverts it to empire/creeps.ts's transport runner
// instead of the step-table dispatch (see behaviors/roles/index.ts's roleDef gap notes).
export class Transport extends Role {
  static override readonly priority = 85; // between hauler (90) and supply (100) — unproven, kept out of their way during the A/B
  static override body(energy: number): BodyPartConstant[] {
    return haulerBody(energy);
  }
}
