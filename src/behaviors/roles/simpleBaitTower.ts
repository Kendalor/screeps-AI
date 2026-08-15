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
  while (energyLeft - BAIT_TOWER_SET_COST > 0 && (numSets + 1) * 3 + SIMPLE_BAIT_TOWER_SET.length <= 50) {
    energyLeft -= BAIT_TOWER_SET_COST;
    numSets++;
  }
  return new Array(numSets * 3).fill(TOUGH).fill(MOVE, numSets).fill(HEAL, numSets * 2).concat(SIMPLE_BAIT_TOWER_SET);
}

export class SimpleBaitTowerRole extends Role {
  static override readonly priority = 30; // placeholder, below the colony's own economy roles
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return simpleBaitTowerBody(energy);
  }
  // 1: advance on the live baitFlag position while at full health (see moveToFlag's doc — dragging the
  // flag redirects the creep immediately). 2: once damaged, flee/heal (see fleeAndHeal's doc) until back
  // to full health, then step 1 resumes and walks it straight back in.
  static override readonly steps: Step[] = [
    { do: "moveToFlag", when: "damaged" },
    { do: "fleeAndHeal", when: "healthy" }
  ];
}
