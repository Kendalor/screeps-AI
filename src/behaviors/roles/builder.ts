import { affordableSets } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// At a 300-capacity room, use a 2-CARRY body (WORK,CARRY,CARRY,MOVE,MOVE = 300) instead of the
// WORK,WORK,CARRY,MOVE base — more carry per trip at RCL1. A/B slow-bench: ~4.5% faster to RCL3,
// ~6% faster to full RCL3 build-out, slightly less energy wasted, no reliable downside.
const B_300_BODY: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE]; // 300

function builderBody(energy: number): BodyPartConstant[] {
  if (energy === 300) return [...B_300_BODY];
  const BASE_BODY = [WORK, WORK, CARRY, MOVE];
  const sets = affordableSets(energy, BASE_BODY, 1, 7);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(BASE_BODY);
  }
  return body;
}

export class Builder extends Role {
  static override readonly priority = 65;
  static override body(energy: number): BodyPartConstant[] {
    return builderBody(energy);
  }
  // Refill from the nearest of drop / storage / container in one step; self-harvest is the slow last
  // resort. Deliberately NOT from haulers: a builder draining a hauler mid-run steals the energy the
  // hauler is carrying to the spawn/extensions, and with a large RCL3 builder cohort that starves the
  // spawn structures and stalls replacements into a colony wipe (the controller container / spawn-fill
  // collapse). Builders draw from the same standing energy (drops, containers) haulers already deliver.
  static override readonly steps: Step[] = [
    {
      do: "gather",
      from: {
        find: "any",
        of: [
          { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy" },
          { find: "dropped" }
        ],
        prefer: "nearest"
      }
    },
    { do: "harvest", from: { find: "source" } },
    { do: "build", at: { find: "constructionSite", prefer: "mostProgress" } }
  ];
}
