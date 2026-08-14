import { affordableSets, bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// TOUGH:ATTACK:MOVE 1:2:3 — TOUGH soaks the first hits (body[0] takes damage first, see orderBody),
// 2 ATTACK per TOUGH for real melee output, 3 MOVE keeps it at full speed on plain terrain even fully
// loaded with parts (1 MOVE per 2 non-MOVE, screeps' road-free speed-1 ratio) so it isn't kited by
// anything lighter. Scales to 5 sets (5 TOUGH/10 ATTACK/15 MOVE) at 1600 energy — an RCL7+ colony's
// full extension cap — the user's own ballpark for a single hard-hitting striker.
const ATTACKER_SET: BodyPartConstant[] = [TOUGH, ATTACK, ATTACK, MOVE, MOVE, MOVE];
const MAX_ATTACKER_SETS = 5;

export const ATTACKER_MIN_COST = bodyCost(ATTACKER_SET);

function attackerBody(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, ATTACKER_SET, 1, MAX_ATTACKER_SETS);
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(...ATTACKER_SET);
  return body;
}

export class Attacker extends Role {
  // Same as DrainAttacker (94): below supply/transport/miner — an offensive strike is expendable relative
  // to colony economy, unlike Defender (110) which still guards it.
  static override readonly priority = 94;
  static override readonly mover = true;
  // Once every ATTACK part is destroyed this body can't fight at all (and carries no WORK part to fall
  // back on dismantling either — see the steps' own doc) — see Role.retreatPart.
  static override readonly retreatPart = ATTACK;
  static override body(energy: number): BodyPartConstant[] {
    return attackerBody(energy);
  }
  // Walk to whichever room Attack assigned, then fight there — same two-step shape as Defender, just a
  // different target-room memory field (attackTargetRoom) so the two roles' assignments never collide.
  // Ordered so a live hostile creep is always engaged first (the only thing that can hurt back), then
  // whatever hostile-owned structure is left (towers, spawns, extensions, an invader core — anything
  // FIND_HOSTILE_STRUCTURES returns, not just the invader-core special case), then a hostile construction
  // site last (trample — see types.ts's "trample" doc — since a site can't fight back or matter until
  // everything that can is cleared). Structures are attacked, never dismantled: this body carries no WORK
  // part (TOUGH/ATTACK/MOVE only), so creep.dismantle() always fails with ERR_NO_BODYPART, whereas
  // creep.attack() works on a Structure exactly as it does on a Creep. Without the structure/site steps,
  // Attack's own roomCleared() (which counts hostile-owned structures too — see snapshot/types.ts's
  // VisibleRoom.hostileCount) could never actually be satisfied once every hostile creep was dead but an
  // enemy structure or site was still standing.
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "attackTargetRoom" },
    { do: "attack", from: { find: "hostile", prefer: "mostThreatening" } },
    { do: "attack", from: { find: "hostileStructure" } },
    { do: "trample", at: { find: "hostileConstructionSite" } }
  ];
}
