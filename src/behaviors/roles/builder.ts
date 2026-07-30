import { affordableSets, bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// At a 300-capacity room, use a 2-CARRY body (WORK,CARRY,CARRY,MOVE,MOVE = 300) instead of the
// WORK,WORK,CARRY,MOVE base — more carry per trip at RCL1. A/B slow-bench: ~4.5% faster to RCL3,
// ~6% faster to full RCL3 build-out, slightly less energy wasted, no reliable downside.
const B_300_BODY: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE]; // 300
// From 350 the base gains a third MOVE (WORK,CARRY,CARRY,MOVE,MOVE,MOVE = 350), then extends by
// WORK,MOVE sets — each set keeps the body move-balanced while adding build throughput.
const B_350_BODY: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE, MOVE]; // 350
const EXT_SET: BodyPartConstant[] = [WORK,CARRY, MOVE]; // 200
// Cap the total body at 1200 energy: 350 base + 5 WORK,MOVE sets (5*150 = 750) = 1100, the most sets
// that fit under 1200. A sixth set would cost 1250, so the body tops out at 16 parts / 1100 energy.
const MAX_BODY_COST = 1200;
const MAX_EXT_SETS = Math.floor((MAX_BODY_COST - bodyCost(B_350_BODY)) / bodyCost(EXT_SET)); // 5

function builderBody(energy: number): BodyPartConstant[] {
  if (energy < 350) {
    if (energy >= 300) return [...B_300_BODY];
    const BASE_BODY = [WORK, WORK, CARRY, MOVE];
    const sets = affordableSets(energy, BASE_BODY, 1, 7);
    let body: BodyPartConstant[] = [];
    for (let i = 0; i < sets; i++) {
      body = body.concat(BASE_BODY);
    }
    return body;
  }
  const extEnergy = energy - bodyCost(B_350_BODY);
  const extSets = affordableSets(extEnergy, EXT_SET, 0, MAX_EXT_SETS);
  let body: BodyPartConstant[] = [...B_350_BODY];
  for (let i = 0; i < extSets; i++) {
    body = body.concat(EXT_SET);
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
  // Ground piles are further gated by unlessSpawnNeedsEnergy: while spawn/extensions aren't full, the
  // builder skips drops entirely (falling through to container/storage or self-harvest) so it never
  // beats the hauler to the exact energy the spawn system needs.
  static override readonly steps: Step[] = [
    {
      do: "gather",
      from: {
        find: "any",
        of: [
          { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy" },
          { find: "dropped", unlessSpawnNeedsEnergy: true }
        ],
        prefer: "nearest"
      }
    },
    { do: "harvest", from: { find: "source" } },
    // Building assigns buildTargetRoom to wherever the colony's nearest outstanding site backlog is
    // (home or a remote room); a no-op once already there (moveToRoom completes instantly, falling
    // through to build the same tick). Absent target (no backlog anywhere) makes this step a pure no-op.
    { do: "moveToRoom", to: "buildTargetRoom" },
    { do: "build", at: { find: "constructionSite", prefer: "mostProgress" } }
  ];
}
