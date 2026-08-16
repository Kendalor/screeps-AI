import type { BodyContext } from "../types";
import { haulerBody } from "./hauler";
import { Role } from "./role";

// A Logistics-owned mover: assignment comes from planLogistics via memory.logistics, not a static step
// table — dispatch: "logistics" routes it to logisticsRunner.ts's runLogisticsMover instead of the
// step-table dispatch (see Role.dispatch's doc, behaviors/roles/role.ts).
export class Transport extends Role {
  // Matches bootstrap (100), just below supply (101): not interleaved with miner — Logistics.desiredCreeps
  // only ever asks for a transport creep once providers()/consumers() are both non-empty (real energy
  // sitting somewhere AND somewhere for it to go), so this can't outrank a miner on work that doesn't
  // exist yet — bootstrap/first miner always go first because nothing is on the ground before then.
  // Once a drop exists, transport should win the very next spawn slot among its peers, full stop — no
  // per-tick rank math tied to live counts, which proved fragile (see docs/logistics-plan.md's
  // maxHaulers:0 step 7). Below supply specifically because a starved spawn — supply's job — stalls
  // everything transport does too.
  static override readonly priority = 100;
  static override readonly mover = true;
  static override readonly dispatch = "logistics";
  static override body(energy: number, ctx: BodyContext): BodyPartConstant[] {
    return haulerBody(energy, ctx.roads);
  }
}
