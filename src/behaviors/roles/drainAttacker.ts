import { affordableSets, bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// ATTACK:MOVE 1:1 — no TOUGH, unlike Attacker: this squad member is protected by the drain squad's
// healers (see ADR 0006), so it doesn't need to soak its own hits the way a standalone striker does.
// 1 MOVE per ATTACK keeps it at full speed on plain terrain (screeps' road-free speed-1 ratio) even
// fully loaded. Scales up to the same 5-set ceiling Attacker uses as a ballpark for a single striker.
const DRAIN_ATTACKER_SET: BodyPartConstant[] = [ATTACK, MOVE];
const MAX_DRAIN_ATTACKER_SETS = 5;

export const DRAIN_ATTACKER_MIN_COST = bodyCost(DRAIN_ATTACKER_SET);

function drainAttackerBody(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, DRAIN_ATTACKER_SET, 1, MAX_DRAIN_ATTACKER_SETS);
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(...DRAIN_ATTACKER_SET);
  return body;
}

// The Drain Energy operation's (issue #34/ADR 0006) melee squad member: sits at the front of the
// formation and prioritizes towers (the source of the operation's namesake energy drain) over any
// hostile creep, falling back to the most threatening hostile once no tower remains in range.
// moveToRoom { to: "attackTargetRoom" } (issue #37's op stamps this to the staging room while
// assembling/retreating, the target room while advancing) carries the squad across room borders;
// moveToPos closes the last stretch onto the operation's per-tick formation/advance-retreat tile (see
// operations/drain.ts's intents(), which is what actually decides where that tile is each tick — this
// role is only the primitive step list + body, no operation wiring here, out of scope for issue #35).
export class DrainAttacker extends Role {
  static override readonly priority = 110; // same table as Attacker/Defender — an ordered squad op is as urgent as either
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return drainAttackerBody(energy);
  }
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "attackTargetRoom" },
    { do: "moveToPos", to: "squadTargetPos" },
    { do: "attack", from: { find: "structure", type: [STRUCTURE_TOWER] } },
    { do: "attack", from: { find: "hostile", prefer: "mostThreatening" } }
  ];
}
