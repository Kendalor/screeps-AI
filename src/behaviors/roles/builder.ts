import { affordableSets } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

function builderBody(energy: number): BodyPartConstant[] {
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
  // Refill from the nearest of drop / storage / container / hauler in one step; self-harvest is the slow last resort.
  static override readonly steps: Step[] = [
    {
      do: "gather",
      from: {
        find: "any",
        of: [
          { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy" },
          { find: "dropped" },
          { find: "creep", role: "hauler", where: "hasEnergy" }
        ],
        prefer: "nearest"
      }
    },
    { do: "harvest", from: { find: "source" } },
    { do: "build", at: { find: "constructionSite", prefer: "mostProgress" } }
  ];
}
