import { affordableSets, bodyCost } from "../body";
import type { Step } from "../types";
import { Role } from "./role";

// Doubled MOVE keeps a loaded creep at road speed (2 fatigue/tick from WORK+CARRY needs 2 MOVE to clear). Capped so a big room fields specialists, not oversized allrounders.
const BOOTSTRAP_SET: BodyPartConstant[] = [WORK, CARRY, MOVE, MOVE];
const MAX_BOOTSTRAP_SETS = 5;

// Sub-500 capacities stated outright: each is a one-off floor, not worth deriving from a formula. Highest rung at or below the budget wins.
const BOOTSTRAP_RUNGS: { at: number; body: BodyPartConstant[] }[] = [
  { at: 450, body: [WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE] },
  { at: 350, body: [WORK, CARRY, CARRY, MOVE, MOVE, MOVE] },
  { at: 250, body: [WORK, CARRY, MOVE, MOVE] }
];

function wholeSets(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, BOOTSTRAP_SET, 1, MAX_BOOTSTRAP_SETS);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(BOOTSTRAP_SET);
  }
  return body;
}

// Repeats the 250 [WORK,CARRY,MOVE,MOVE] set as many times as the budget buys, reading sub-500 capacities from BOOTSTRAP_RUNGS.
// Remainder above 500 is deliberately unspent: a bootstrap fills at 2 energy/tick per WORK, so the next whole WORK always beats extra CARRY.
function bootstrapBody(energy: number): BodyPartConstant[] {
  const rung = BOOTSTRAP_RUNGS.find(r => energy >= r.at);
  if (rung && energy < bodyCost(BOOTSTRAP_SET) * 2) return [...rung.body];
  return wholeSets(energy);
}

export class Bootstrap extends Role {
  static override readonly priority = 100;
  static override body(energy: number): BodyPartConstant[] {
    return bootstrapBody(energy);
  }
  // Steps with no valid target are skipped, so this single wrap-around loop covers supply, build and upgrade.
  static override readonly steps: Step[] = [
    { do: "pickup", from: { find: "dropped", prefer: "largest" } },
    { do: "harvest", from: { find: "source" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_TOWER, where: "notFull" } },
    { do: "build" },
    { do: "upgrade" }
  ];
}
