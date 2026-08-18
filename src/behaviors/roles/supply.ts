import { affordableSets, haulerBody } from "../../spawn/body";
import type { BodyContext } from "../types";
import { Role } from "./role";

// From RCL6, two supply creeps split the topping-off work instead of one — a bigger bunker means
// longer round trips, and two smaller haulers keep sinks fed while one is still travelling. Each is
// built from 2:1 CARRY:MOVE sets (rather than hauler's 1:1) since a supply creep's hops are short and
// it doesn't need full off-road speed the way a hauler crossing to a remote does, and is capped to
// half of what a single full-size hauler body would carry at the same energy.
export const config = {
  twoSupplyRcl: 6
} as const;

const SUPPLY_SET: BodyPartConstant[] = [CARRY, CARRY, MOVE];
const MAX_HAULER_SETS = 25; // matches hauler.ts's cap — 25 sets = 50 parts, the hard body cap

export function supplyBody(energy: number, controllerLevel: number, roads = false): BodyPartConstant[] {
  if (controllerLevel < config.twoSupplyRcl) return haulerBody(energy, roads);

  const fullSets = affordableSets(energy, SUPPLY_SET, 1, MAX_HAULER_SETS);
  const halfSets = Math.max(1, Math.floor(fullSets / 2));
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < halfSets; i++) {
    body = body.concat(SUPPLY_SET);
  }
  return body;
}

// A Logistics-owned mover, same as Transport: assignment comes from planLogistics via memory.logistics
// (restricted to spawn/extension/tower sinks and non-remote sources — see logistics/graph.ts's
// supplyProviders/supplyConsumers), not a static step table — dispatch: "logistics" routes it to
// logisticsRunner.ts's runLogisticsMover instead of the step-table dispatch (see Role.dispatch's doc,
// behaviors/roles/role.ts).
export class Supply extends Role {
  // Strictly above transport (100): a starved spawn stalls the whole colony, and supply is what
  // refills extensions from storage so bigger bodies (miners/haulers sized off capacity) ever become
  // affordable. Was tied with transport at 100, broken only by operations/index.ts's array order —
  // that silently starved supply outright (not just in the brief RCL3 crossover it was meant for)
  // whenever transport wanted a creep the same tick, since a single-spawn room's stable sort let
  // transport claim the only idle slot every time. See git history for the incident.
  static override readonly priority = 101;
  static override readonly mover = true;
  static override readonly dispatch = "logistics";
  static override body(energy: number, ctx: BodyContext): BodyPartConstant[] {
    return supplyBody(energy, ctx.controllerLevel ?? 0, ctx.roads);
  }
}
