import { haulerBody } from "./hauler";
import { Role } from "./role";

// A Logistics-owned mover: assignment comes from planLogistics via memory.logistics, not a static step
// table — steps stays empty so runCreepBehaviors() diverts it to empire/creeps.ts's transport runner
// instead of the step-table dispatch (see behaviors/roles/index.ts's roleDef gap notes).
export class Transport extends Role {
  // Highest overall (matches bootstrap/supply), not interleaved with miner: Logistics.desiredCreeps
  // only ever asks for a transport creep once providers()/consumers() are both non-empty (real energy
  // sitting somewhere AND somewhere for it to go), so this can't outrank a miner on work that doesn't
  // exist yet — bootstrap/first miner always go first because nothing is on the ground before then.
  // Once a drop exists, transport should win the very next spawn slot, full stop — no per-tick rank
  // math tied to live counts, which proved fragile (see docs/logistics-plan.md's maxHaulers:0 step 7).
  static override readonly priority = 100;
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return haulerBody(energy);
  }
}
