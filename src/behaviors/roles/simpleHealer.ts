import { bodyCost, parts } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// A SimpleHealer creep's whole job: same shape as DefenderRole (see defender.ts) — walk to
// creep.memory.targetRoom (a no-op once already there, self-completes on arrival, no flag-tracking, no
// damage-gated retreat) and act there. What it does once it's in: heal whichever friendly creep in the
// room (self included) is most damaged, via find:"friendly" (behaviors/targets.ts) rather than
// find:"squadMate" — a solo SimpleHealer has no squad (memory.op is unique to itself), so squadMate would
// only ever resolve to itself. "mostDamaged" prioritizes the acting creep itself over any other damaged
// friendly (see pickByPrefer in targets.ts) — this healer patches itself up before anyone else. targetRoom
// itself is resolved from the triggering flag's own room — see SimpleHealOperation/empire/singleTargetFlags.ts.
const SIMPLE_HEALER_SET: BodyPartConstant[] = [HEAL, MOVE];

export const SIMPLE_HEALER_MIN_COST = bodyCost(SIMPLE_HEALER_SET);
export const MAX_BODY_COST = 2000;

function simpleHealerBody(energy: number): BodyPartConstant[] {
  const numSets = Math.min(Math.floor(energy / SIMPLE_HEALER_MIN_COST), MAX_BODY_COST);
  return [...parts(HEAL, numSets), ...parts(MOVE, numSets)];
}

export class SimpleHealerRole extends Role {
  static override readonly priority = 66; // above builder(65), same table as SimpleBaitTower/Demolisher
  static override readonly mover = true;
  // Once every HEAL part is destroyed this body can't do its job at all — see Role.retreatPart.
  static override readonly retreatPart = HEAL;
  static override body(energy: number): BodyPartConstant[] {
    return simpleHealerBody(energy);
  }
  // Walk to targetRoom, then heal whichever friendly creep there (self included) is most damaged. A
  // no-op once already in that room, same as Defender's own moveToRoom step.
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "targetRoom" },
    { do: "heal", at: { find: "friendly", where: "damaged", prefer: "mostDamaged" } }
  ];
}
