import { affordableSets } from "../../spawn/body";
import { REPAIRABLE, REPAIR_BELOW } from "../../lib/repairable";
import type { Step } from "../types";
import { Role } from "./role";

// Same WORK/CARRY body shape as the builder it converts from (a converted builder keeps its own body;
// this is only used if a repairer is ever spawned directly). 2:1 weight:MOVE for road speed.
function repairBody(energy: number): BodyPartConstant[] {
  const BASE_BODY = [WORK, CARRY, MOVE, MOVE];
  const sets = affordableSets(energy, BASE_BODY, 1, 6);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(BASE_BODY);
  }
  return body;
}

export class Repair extends Role {
  static override readonly priority = 64; // just below builder; upkeep matters less than new construction
  static override body(energy: number): BodyPartConstant[] {
    return repairBody(energy);
  }
  // Repair the nearest decaying structure, refilling from the nearest energy source when empty; self-harvest
  // is the last resort. A repairer with nothing left below the repair floor falls through to gather/harvest
  // and simply idles topped-up — the Building operation converts it back once real work reappears.
  static override readonly steps: Step[] = [
    { do: "repair", at: { find: "structure", type: REPAIRABLE, where: "damaged", repairBelow: REPAIR_BELOW } },
    {
      do: "gather",
      from: {
        find: "any",
        of: [
          { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy" },
          { find: "dropped" },
          { find: "tombstone" }
        ],
        prefer: "nearest"
      }
    },
    { do: "harvest", from: { find: "source" } }
  ];
}
