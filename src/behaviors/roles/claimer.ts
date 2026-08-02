import { affordableSets, bodyCost, parts } from "../../spawn/body";
import type { BodyContext, Step } from "../types";
import { Role } from "./role";

// A claimer reserves a remote room's controller (5->10 energy/tick on that room's sources). Body is
// CLAIM+MOVE pairs. reserveController() adds one reservation-tick per CLAIM part on every call, but the
// controller also decays by 1 tick on every tick nobody reserves it that tick — a claimer parked and
// calling every tick (see interpreter.ts's reserveStep, which never leaves) only nets the DIFFERENCE
// between its CLAIM count and that decay. A single-CLAIM claimer therefore nets zero: it merely holds the
// line while alive and provides no banked buffer, so reservation free-falls to 0 the instant it dies,
// mid-transit, before its replacement arrives — costing a real chunk of the room's mined sources' 5/tick
// reservation gain every spawn cycle. 2 CLAIM is the minimum that ever banks a surplus (nets +1/tick while
// parked), giving the replacement's travel time a buffer instead of relying on a zero-gap handoff.
const CLAIMER_SET: BodyPartConstant[] = [CLAIM, MOVE];
const MIN_CLAIM_SETS = 2; // floor: 1 CLAIM merely offsets decay and banks nothing, see above
const MAX_CLAIM_SETS = 3; // a reservation caps at 5000 ticks; 3 CLAIM refills it far faster than it decays

function claimerBody(energy: number): BodyPartConstant[] {
  // Floor at MIN_CLAIM_SETS even below its cost — an unaffordable claimer is simply never *requested*
  // (the operation gates on energyCapacity), but the body formula must still return a legal, moving body.
  const sets = Math.max(MIN_CLAIM_SETS, affordableSets(energy, CLAIMER_SET, 0, MAX_CLAIM_SETS));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(...parts(CLAIM, 1), ...parts(MOVE, 1));
  return body;
}

export class Claimer extends Role {
  // Below the local economy (a remote's reservation is future value, never ahead of the home room's own
  // miners/haulers), but a settled colony that has selected a remote fields one.
  static override readonly priority = 25;
  static override body(energy: number, _ctx: BodyContext): BodyPartConstant[] {
    return claimerBody(energy);
  }
  // Walk to the remote room (targetRoom set at spawn), then reserve its controller for life.
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "targetRoom", avoidDanger: true },
    { do: "reserve" }
  ];
}

// Kept for callers that want the minimum cost without building the body. claimerBody() floors at
// MIN_CLAIM_SETS (never a single set), so the real minimum is that floor's cost, not one set's.
export const CLAIMER_MIN_COST = bodyCost(CLAIMER_SET) * MIN_CLAIM_SETS;
