import { affordableSets, bodyCost, parts } from "../../spawn/body";
import type { BodyContext, Step } from "../types";
import { Role } from "./role";

// A claimer reserves a remote room's controller (5->10 energy/tick on that room's sources). Body is
// CLAIM+MOVE pairs: each CLAIM adds 1 to the reservation per tick, so more parts reserve faster and let
// one claimer cover the walk-out gap between dying and being replaced. CLAIM is 600 energy — the
// affordability gate (pickRemotes / Reservation) matters, so the floor is a single pair and it only
// scales up when the home room can genuinely afford it.
const CLAIMER_SET: BodyPartConstant[] = [CLAIM, MOVE];
const MAX_CLAIM_SETS = 3; // a reservation caps at 5000 ticks; 3 CLAIM refills it far faster than it decays

function claimerBody(energy: number): BodyPartConstant[] {
  // Floor at one pair even below its cost — an unaffordable claimer is simply never *requested* (the
  // operation gates on energyCapacity), but the body formula must still return a legal, moving body.
  const sets = Math.max(1, affordableSets(energy, CLAIMER_SET, 0, MAX_CLAIM_SETS));
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
    { do: "moveToRoom", to: "targetRoom" },
    { do: "reserve" }
  ];
}

// Kept for callers that want the minimum cost without building the body.
export const CLAIMER_MIN_COST = bodyCost(CLAIMER_SET);
