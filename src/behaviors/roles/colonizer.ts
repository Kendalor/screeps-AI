import { affordableSets, bodyCost, parts } from "../../spawn/body";
import type { BodyContext, Step } from "../types";
import { Role } from "./role";

// A colonizer claims a new room's controller outright (claimController), turning it into a fully
// autonomous colony — a one-time act, unlike Claimer's reserveController which must be renewed for life.
// claimController itself only ever needs 1 CLAIM part (the engine ignores any more on a claim call), but
// a target room already reserved by another player must be attackController'd down to 0 first (see
// claimStep in interpreter.ts) — and attackController's downgrade-per-call scales with CLAIM count, same
// as claimController's reservation-per-call does for Claimer. 2 CLAIM (the same floor Claimer uses, see
// its own comment) is worth spawning when affordable so a contested target doesn't take forever to clear;
// 1 MOVE per CLAIM keeps it at full speed on plain terrain carrying nothing.
const COLONIZER_SET: BodyPartConstant[] = [CLAIM, MOVE];
const MIN_CLAIM_SETS = 1; // a lone CLAIM still claims an unreserved room fine; just slow to fight a reserved one
const MAX_CLAIM_SETS = 2; // claimController never needs more; attackController's extra downgrade is the only reason to go past 1

function colonizerBody(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, COLONIZER_SET, MIN_CLAIM_SETS, MAX_CLAIM_SETS);
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(...parts(CLAIM, 1), ...parts(MOVE, 1));
  return body;
}

export class Colonizer extends Role {
  // Whether a colonizer should ever outrank a settled colony's own economy is a target-selection
  // question (does the empire want to colonize right now), not a body/step concern — this priority only
  // decides ordering among requests actually emitted. One above Settler (65): the claim is what makes a
  // colonize attempt worth anything at all — a settler has nothing to bootstrap until the room is
  // actually owned — and it's a cheap, one-shot body, not an ongoing drain, so it should never wait
  // behind the settler it's paired with for a spawn slot.
  static override readonly priority = 66;
  static override body(energy: number, _ctx: BodyContext): BodyPartConstant[] {
    return colonizerBody(energy);
  }
  // Walk to the target room (targetRoom set at spawn), then claim its controller once. A controller
  // already reserved by another player rejects claimController outright (ERR_INVALID_TARGET) — claimStep
  // falls back to attackController against it instead, chipping the reservation down every tick until it
  // hits 0 and a claim can actually land (see claimStep in interpreter.ts). oneShot: unlike reserve,
  // find:"controller" keeps resolving after a successful claim (it's still creep.room.controller, just
  // now with .my true) — there is no targetGone to fall back on, so without oneShot the step would call
  // claimController every tick forever (harmless but never "complete"). didAct only reports true on the
  // actual successful claim (attackController calls report acted-but-not-didAct, same as a rejected
  // claimController), so oneShot only completes the step once the room is genuinely ours. Once claimed,
  // the room appears as a Colony next tick and this creep's job is done — nothing here demotes or
  // reassigns it (see the future Expansion operation for what happens to it after handoff).
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "targetRoom" },
    { do: "claim", oneShot: true }
  ];
}

// Cheapest legal colonizer body, for affordability gates — mirrors CLAIMER_MIN_COST/SETTLER_MIN_COST.
export const COLONIZER_COST = bodyCost(COLONIZER_SET) * MIN_CLAIM_SETS;
