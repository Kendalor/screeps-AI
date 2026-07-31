import { affordableSets } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// RANGED_ATTACK+MOVE pairs: ranged damage per part beats melee's, and 1:1 MOVE keeps it from losing a
// kiting/chasing race against the invaders (themselves usually MOVE-light) it exists to beat. Floored at
// one pair so even an RCL2 room (200 energy) can field something; capped well past what a lone invader
// needs so a colony never overspends a whole spawn queue defending against a routine incursion.
const DEFENDER_SET: BodyPartConstant[] = [RANGED_ATTACK, MOVE];
const MAX_DEFENDER_SETS = 5;

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
  static override body(energy: number): BodyPartConstant[] {
    return defenderBody(energy);
  }
  // Walk to whichever room Defense assigned (home or an invaded remote), then fight there. A no-op once
  // already in that room, same as repair's repairTargetRoom step — falls straight through to attack.
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "defendTargetRoom" },
    { do: "attack", from: { find: "hostile" } }
  ];
}
