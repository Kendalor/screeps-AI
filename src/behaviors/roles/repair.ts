import { affordableSets } from "../../spawn/body";
import { REPAIRABLE } from "../../lib/repairable";
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
  static override readonly doNotBlockRoads = true;
  static override body(energy: number): BodyPartConstant[] {
    return repairBody(energy);
  }
  // Two-tier target search so the repairer doesn't crisscross the room chasing the single most-damaged
  // structure while ignoring one it's standing next to: first look for anything below 50% (there's a
  // real emergency, go to the worst of those); only once none qualify, widen to any decay at all and
  // take the nearest one instead of the most damaged, so mopping up minor decay stays local.
  // Refills from the nearest energy source when empty; self-harvest is the last resort. A repairer with
  // nothing left to repair falls through to gather/harvest and idles topped-up — the Building operation
  // converts it back once real work reappears.
  // Repairing assigns repairTargetRoom to wherever the colony's nearest outstanding decay is (home or a
  // remote room); a no-op once already there (moveToRoom completes instantly, falling through to repair
  // the same tick). Absent target (no decay anywhere) makes this step a pure no-op, same as builder's
  // buildTargetRoom step.
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "repairTargetRoom" },
    { do: "repair", at: { find: "structure", type: REPAIRABLE, where: "damaged", repairBelow: 0.5, prefer: "mostDamaged" } },
    { do: "repair", at: { find: "structure", type: REPAIRABLE, where: "damaged", prefer: "nearest" } },
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
