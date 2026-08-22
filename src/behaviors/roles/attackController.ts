import { affordableSets, bodyCost, parts } from "../../spawn/body";
import type { BodyContext, Step } from "../types";
import { Role } from "./role";

// An AttackController creep's whole job: walk to the flag/targetRoom and attackController the controller
// there — never reserveController or claimController, just downgrade/hold-down for as long as it's alive.
// Body is deliberately identical to Claimer's (see claimer.ts's own doc for the full CLAIM/decay math —
// attackController's per-call downgrade scales with CLAIM count exactly the same way reserveController's
// per-call gain does), reused verbatim rather than re-derived.
const ATTACK_CONTROLLER_SET: BodyPartConstant[] = [CLAIM, MOVE];
const MIN_CLAIM_SETS = 2;
const MAX_CLAIM_SETS = 3;

function attackControllerBody(energy: number): BodyPartConstant[] {
  const sets = Math.max(MIN_CLAIM_SETS, affordableSets(energy, ATTACK_CONTROLLER_SET, 0, MAX_CLAIM_SETS));
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(...parts(CLAIM, 1), ...parts(MOVE, 1));
  return body;
}

export class AttackControllerRole extends Role {
  static override readonly priority = 66; // same table slot as SimpleBaitTower/Demolisher — a flag-triggered one-shot, not core economy
  static override readonly mover = true;
  // Once every CLAIM part is destroyed this body can't attackController at all — see Role.retreatPart.
  static override readonly retreatPart = CLAIM;
  static override body(energy: number, _ctx: BodyContext): BodyPartConstant[] {
    return attackControllerBody(energy);
  }
  // 0: recycleIfOperationGone — no-op while the AttackController flag/op is still live; see that step's
  // own doc (behaviors/types.ts) for the "flag pulled while alive" recycle path this pre-empts with.
  // 1: walk onto the live followFlag position (falls back to targetRoom — see moveToFlag's doc). Once
  // within range 1 of the flag, moveToFlagStep returns acted:false and runOne's same-tick retry loop
  // falls straight through to step 2 (same fall-through demolisher.ts's dismantle step relies on).
  // 2: attackController the room's controller (its own range-1 travelTo, independent of the flag's exact
  // placement) for life — no retreat/heal leg, unlike SimpleBaitTower/Demolisher; retreatPart above is
  // this role's only defensive behavior.
  static override readonly steps: Step[] = [
    { do: "recycleIfOperationGone" },
    { do: "moveToFlag" },
    { do: "attackController" }
  ];
}

// Kept for callers that want the minimum cost without building the body, same reasoning as
// CLAIMER_MIN_COST — attackControllerBody floors at MIN_CLAIM_SETS, so the real minimum is that floor's cost.
export const ATTACK_CONTROLLER_MIN_COST = bodyCost(ATTACK_CONTROLLER_SET) * MIN_CLAIM_SETS;
