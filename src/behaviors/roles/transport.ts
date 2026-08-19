import type { BodyContext } from "../types";
import { haulerBody } from "../../spawn/body";
import { Role } from "./role";

// A Logistics-owned mover: dispatch: "logistics" routes it through empire/creeps.ts's dispatchCreep,
// which (as of gh #52's cutover) sends role==="transport" to transportTaskRunner.ts's runTransportTask —
// the new LogisticsRequest/Task pool, not logisticsRunner.ts's old runTransport (that old path still
// serves Supply only, until gh #53 cuts it over too; see graph.ts's header for the dead-Transport-code
// note this class's old "providers()/consumers()" framing referred to).
export class Transport extends Role {
  // Matches bootstrap (100), just below supply (101): not interleaved with miner — Logistics.desiredCreeps
  // only ever asks for a transport creep once transportPoolHasConsumer (operations/logistics.ts) confirms
  // the new pool actually has somewhere to deliver, so this can't outrank a miner on work that doesn't
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
