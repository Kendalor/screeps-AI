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
  // Same table as Defender (110): an offensive strike is exactly as urgent as a defensive one once the
  // player has ordered it — neither should wait behind ordinary economy demand.
  static override readonly priority = 110;
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return attackerBody(energy);
  }
  // Walk to whichever room Attack assigned, then fight there — same two-step shape as Defender, just a
  // different target-room memory field (attackTargetRoom) so the two roles' assignments never collide.
  // The core is attacked (not dismantled) ahead of any hostile creep: this body carries no WORK part
  // (TOUGH/ATTACK/MOVE only), so creep.dismantle() always fails with ERR_NO_BODYPART, whereas
  // creep.attack() works on a Structure exactly as it does on a Creep. find:"hostile" only ever resolves
  // FIND_HOSTILE_CREEPS (see behaviors/targets.ts), so a room holding nothing but an invader core —
  // Attack's own roomCleared() counts hostile-owned structures too, see snapshot/types.ts's
  // VisibleRoom.hostileCount — would otherwise never actually get touched.
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "attackTargetRoom" },
    { do: "attack", from: { find: "structure", type: [STRUCTURE_INVADER_CORE] } },
    { do: "attack", from: { find: "hostile", prefer: "mostThreatening" } }
  ];
}
