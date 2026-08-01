import { bodyCost } from "../../spawn/body";
import type { BodyContext, Step } from "../types";
import { Role } from "./role";

// A colonizer claims a new room's controller outright (claimController), turning it into a fully
// autonomous colony — a one-time act, unlike Claimer's reserveController which must be renewed for life.
// claimController accepts exactly 1 CLAIM part; the engine ignores any more on a claim call, so — unlike
// claimerBody's scaling MIN/MAX_CLAIM_SETS — there is no reason to ever spawn a second one. 1 MOVE keeps
// it at full speed on plain terrain: it carries nothing, so it's never slowed by load, only by the swamp
// tiles a route happens to cross (same tradeoff every other remote traveler in this codebase accepts).
const COLONIZER_BODY: BodyPartConstant[] = [CLAIM, MOVE];

export class Colonizer extends Role {
  // Whether a colonizer should ever outrank a settled colony's own economy is a target-selection
  // question (does the empire want to colonize right now), not a body/step concern — this priority only
  // decides ordering among requests actually emitted. One above Settler (65): the claim is what makes a
  // colonize attempt worth anything at all — a settler has nothing to bootstrap until the room is
  // actually owned — and it's a single cheap (650), one-shot body, not an ongoing drain, so it should
  // never wait behind the settler it's paired with for a spawn slot.
  static override readonly priority = 66;
  static override body(_energy: number, _ctx: BodyContext): BodyPartConstant[] {
    return COLONIZER_BODY;
  }
  // Walk to the target room (targetRoom set at spawn), then claim its controller once. oneShot: unlike
  // reserve, find:"controller" keeps resolving after a successful claim (it's still creep.room.controller,
  // just now with .my true) — there is no targetGone to fall back on, so without oneShot the step would
  // call claimController every tick forever (harmless but never "complete"). oneShot completes it the
  // instant the call actually fires, matching the one-time nature of the game action itself. Once claimed,
  // the room appears as a Colony next tick and this creep's job is done — nothing here demotes or
  // reassigns it (see the future Expansion operation for what happens to it after handoff).
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "targetRoom" },
    { do: "claim", oneShot: true }
  ];
}

export const COLONIZER_COST = bodyCost(COLONIZER_BODY);
