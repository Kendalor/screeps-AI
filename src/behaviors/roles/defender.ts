import { affordableSets, bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// RANGED_ATTACK+MOVE pairs: ranged damage per part beats melee's, and 1:1 MOVE keeps it from losing a
// kiting/chasing race against the invaders (themselves usually MOVE-light) it exists to beat. Floored at
// one pair so even an RCL2 room (200 energy) can field something; capped well past what a lone invader
// needs so a colony never overspends a whole spawn queue defending against a routine incursion.
const DEFENDER_SET: BodyPartConstant[] = [RANGED_ATTACK, MOVE];
const MAX_DEFENDER_SETS = 5;

// The floor a sponsoring colony must afford before defendSponsor.ts will hand it a flag-requested
// defend target — same role ATTACKER_MIN_COST plays for attackSponsor.ts, sized off the single cheapest
// real set rather than MAX_DEFENDER_SETS, so a small colony can still sponsor a rescue.
export const DEFENDER_MIN_COST = bodyCost(DEFENDER_SET);

function defenderBody(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, DEFENDER_SET, 1, MAX_DEFENDER_SETS);
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(RANGED_ATTACK, MOVE);
  return body;
}

export class Defender extends Role {
  // Above every economy role: a live invasion outranks spawning anything else — see spawn priority table
  // (supply/transport/bootstrap all sit at 100). Below RECOVERY_PRIORITY, which stays the one thing that
  // can never be preempted.
  static override readonly priority = 110;
  static override readonly mover = true;
  // Once every RANGED_ATTACK part is destroyed this body can't fight at all — see Role.retreatPart.
  static override readonly retreatPart = RANGED_ATTACK;
  static override body(energy: number): BodyPartConstant[] {
    return defenderBody(energy);
  }
  // Walk to whichever room Defense assigned (home or an invaded remote), then fight there. A no-op once
  // already in that room, same as repair's repairTargetRoom step — falls straight through to attack.
  //
  // avoidDanger on the TRANSIT step only: dangerRouteCallback/dangerCostMatrix never penalize the origin
  // or destination room itself (see interpreter.ts's dangerRouteCallback doc), only rooms merely being
  // cut through — so this steers the defender around a Source Keeper room (or reputation-dangerous
  // hostile) that happens to sit on the road to defendTargetRoom, without ever routing away from
  // defendTargetRoom even if THAT room is itself a Keeper room. Safe unlike the general
  // "defender/attacker walking toward hostiles on purpose must never set this" warning on avoidDanger's
  // own doc, which is about the attack step's own implicit travel toward its resolved target — this is a
  // separate, earlier step that completes (via arrival) before attack ever starts.
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "defendTargetRoom", avoidDanger: true },
    // mostThreatening: engage whatever can actually hurt us (ATTACK/RANGED_ATTACK) before a healer or an
    // unarmed body, regardless of which happens to be nearer — see attackStep's kiting note above.
    // find:"hostile" itself already excludes anything the defender would predictably lose to (see
    // targets.ts's wouldLoseTo) — a Source Keeper guardian standing IN defendTargetRoom is still engaged
    // once the defender's body can actually beat it, but never before.
    { do: "attack", from: { find: "hostile", prefer: "mostThreatening" } }
  ];
}
