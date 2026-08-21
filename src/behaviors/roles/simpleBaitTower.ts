import { bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// A SimpleBaitTower creep's whole job: walk into targetRoom and sit there drawing hostile tower fire away
// from something else, pulling back out to heal up and re-entering once it takes damage.
const SIMPLE_BAIT_TOWER_SET: BodyPartConstant[] = [ATTACK, HEAL, MOVE, MOVE];

export const SIMPLE_BAIT_TOWER_MIN_COST = bodyCost(SIMPLE_BAIT_TOWER_SET);

const BAIT_TOWER_SET_COST = bodyCost([TOUGH, HEAL, MOVE,MOVE]);

function simpleBaitTowerBody(energy: number): BodyPartConstant[] {
  let energyLeft = energy - bodyCost(SIMPLE_BAIT_TOWER_SET);
  let numSets = 0;
  while (energyLeft - BAIT_TOWER_SET_COST > 0 && (numSets + 1) * 4 + SIMPLE_BAIT_TOWER_SET.length <= 50) {
    energyLeft -= BAIT_TOWER_SET_COST;
    numSets++;
  }
  return new Array(numSets * 4)
    .fill(TOUGH, 0, numSets)
    .fill(HEAL, numSets, numSets * 2)
    .fill(MOVE, numSets * 2, numSets * 4)
    .concat(SIMPLE_BAIT_TOWER_SET);
}

export class SimpleBaitTowerRole extends Role {
  static override readonly priority = 66; // above builder(65) per user request
  static override readonly mover = true;
  // Once every HEAL part is destroyed this body can no longer self-heal, so soaking further tower fire is
  // pure loss instead of the intended damage-absorption trade — retreat home the same way Defender/
  // Attacker/SimpleHealer already do once disarmed of THEIR one defining part. See Role.retreatPart.
  static override readonly retreatPart = HEAL;
  static override body(energy: number): BodyPartConstant[] {
    return simpleBaitTowerBody(energy);
  }
  // Advance on the live followFlag position (see baitTowerAdvance's doc — dragging the flag redirects the
  // creep immediately), attacking whatever hostile structure sits nearest the flag (the tower it's
  // baiting, most of the time) once in range — same "nearestToFlag" targeting Demolisher uses for
  // dismantle. No damaged/healthy retreat leg here: retreatPart above pre-empts the whole step table once
  // HEAL is gone (see runOne's dispatch order), so these steps only ever run while still able to self-heal.
  static override readonly steps: Step[] = [
    { do: "baitTowerAdvance", when: "damaged" },
    { do: "fleeAndHeal", when: "healthy" }
  ];
}
