import { bodyCost, parts } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// A SimpleHealer creep's whole job: advance on the live followFlag position via "healerAdvance" (see its
// doc in interpreter.ts/types.ts — a SimpleHealer-only variant of moveToFlag, dragging the flag redirects
// the creep immediately). What it does once it's in: heal whichever friendly creep in the room (self
// included) is most damaged, via find:"friendly" (behaviors/targets.ts) rather than find:"squadMate" — a
// solo SimpleHealer has no squad (memory.op is unique to itself), so squadMate would only ever resolve to
// itself. "nearestDamaged" prioritizes the acting creep itself over any other damaged friendly, then
// whoever's most hurt among patients within heal-assist range, then plain proximity beyond that (see
// pickByPrefer in targets.ts) — this healer patches itself up before anyone else, and doesn't walk across
// the room past an ally standing right next to it just because someone farther away has a lower hits%.
//
// "healerAdvance" (unlike plain "moveToFlag", which DemolisherRole/AttackControllerRole use) yields the
// moment ANY friendly in the room needs healing, not only once the creep reaches the flag's exact tile —
// letting "heal" preempt mid-march. Plain moveToFlag's arrival-only yield is too late for a healer: if the
// flag's exact tile is occupied or otherwise unreachable, the healer would march for it forever and never
// actually stop to heal anyone. Confirmed live: a healer walked right past a damaged ally without stopping
// because it hadn't yet reached the flag's exact tile.

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
  // Advance on the live followFlag position, then heal whichever friendly creep there (self included) is
  // most damaged.
  static override readonly steps: Step[] = [
    { do: "recycleIfOperationGone" },
    { do: "healerAdvance" },
    { do: "heal", at: { find: "friendly", where: "damaged", prefer: "nearestDamaged" } }
  ];
}
