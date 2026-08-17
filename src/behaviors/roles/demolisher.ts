import { bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// A Demolisher creep's whole job: same advance/retreat shape as SimpleBaitTowerRole (walk in on the
// live flag, fall back and heal once damaged, re-enter once healthy) — see simpleBaitTower.ts for that
// half. The difference is what it does once it's in: instead of just sitting there soaking fire, it
// dismantles the hostile structure nearest the flag (range 0 to the flag = highest priority), via the
// new "nearestToFlag" prefer strategy (behaviors/targets.ts's pickByPrefer) reading
// creep.memory.followFlag.
export const DEMOLISHER_BASE_BODY = [WORK, MOVE];
export const DEMOLISHER_MIN_COST = bodyCost(DEMOLISHER_BASE_BODY);
export const MAX_BODY_COST = 2000;

function demolisherBody(energy: number): BodyPartConstant[] {
  const numSets = Math.min(Math.floor(energy / DEMOLISHER_MIN_COST), MAX_BODY_COST);
  return new Array(2 * numSets).fill(WORK).fill(MOVE, numSets);
}

export class DemolisherRole extends Role {
  static override readonly priority = 66; // above builder(65) per user request
  static override readonly mover = true;
  // Once every WORK part is destroyed this body can't dismantle anything — see Role.retreatPart.
  static override readonly retreatPart = WORK;
  static override body(energy: number): BodyPartConstant[] {
    return demolisherBody(energy);
  }
  // 1: advance on the live followFlag position while at full health (see moveToFlag's doc — dragging
  // the flag redirects the creep immediately), dismantling whatever hostile structure sits nearest the
  // flag once in range. 2: once damaged, flee/heal (see fleeAndHeal's doc) until back to full health,
  // then step 1 resumes and walks it straight back in.
  static override readonly steps: Step[] = [
    { do: "moveToFlag", when: "damaged" },
    { do: "dismantle", at: { find: "hostileStructure", prefer: "nearestToFlag" }, when: "damaged" },
    { do: "fleeAndHeal", when: "healthy" }
  ];
}
