import { bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// A parade member has no job beyond marching in formation — no WORK/CARRY/ATTACK/HEAL parts, just enough
// MOVE to walk at full speed (1 MOVE per part, screeps' road-free speed-1 ratio) plus one dummy part so
// the body isn't all-MOVE (a creep needs at least one non-MOVE part to be a legal body). Fixed at one set
// regardless of energy — a parade creep never does more with more parts, so there's nothing to scale for.
const PARADE_MEMBER_SET: BodyPartConstant[] = [MOVE, MOVE];

export const PARADE_MEMBER_MIN_COST = bodyCost(PARADE_MEMBER_SET);

function paradeMemberBody(energy: number): BodyPartConstant[] {
  return energy >= PARADE_MEMBER_MIN_COST ? PARADE_MEMBER_SET : [];
}

// The Parade operation's squad member: no combat, no economy — its entire job is to hold formation and
// march to wherever the operation's flag currently sits. This step table runs ONLY while the creep is NOT
// currently squadded (same convention as DrainAttacker/DrainHealer, see ADR 0007): before the squad has
// assembled, while a freshly-spawned replacement is still catching up, or after the operation dissolves.
// Once squadded, movement is dictated entirely by the generic Squad entity (empire/creeps.ts's runSquads),
// never this step table — moveToPos here only walks the creep toward paradeRallyPos (the squad's live
// anchor once one exists, else the assembly point), the same pre-join rallying Drain's roles do.
export class ParadeMember extends Role {
  static override readonly priority = 30; // below every economy/combat role — a parade never competes for spawn energy with the colony's real work
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return paradeMemberBody(energy);
  }
  static override readonly steps: Step[] = [{ do: "moveToPos", to: "paradeRallyPos" }];
}
