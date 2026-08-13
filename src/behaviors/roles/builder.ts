import { affordableSets, bodyCost } from "../../spawn/body";
import type { BodyContext, Step } from "../types";
import { Role } from "./role";

// At a 300-capacity room, use a 2-CARRY body (WORK,CARRY,CARRY,MOVE,MOVE = 300) instead of the
// WORK,WORK,CARRY,MOVE base — more carry per trip at RCL1. A/B slow-bench: ~4.5% faster to RCL3,
// ~6% faster to full RCL3 build-out, slightly less energy wasted, no reliable downside.
const B_300_BODY: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE]; // 300
// From 350 the base gains a third MOVE (WORK,CARRY,CARRY,MOVE,MOVE,MOVE = 350), then extends by
// WORK,CARRY,MOVE sets — 1:1 weight:MOVE, same as the base, so extending never dilutes the ratio.
const B_350_BODY: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE, MOVE]; // 350
// Off-road default: 1 MOVE per weight part (WORK+CARRY) so a builder never fatigues working an
// unpaved remote route or a home leg not yet built — same convention as repair.ts/hauler.ts.
const EXT_SET: BodyPartConstant[] = [WORK, CARRY, MOVE, MOVE]; // 250
// 2:1 weight:MOVE once every route is paved (ctx.roads), matching repair/upgrader's road-speed set.
const EXT_SET_ROADS: BodyPartConstant[] = [WORK, CARRY, MOVE]; // 200
// Cap the total body at 1200 energy — the most extension sets that fit under that budget.
const MAX_BODY_COST = 1200;
const MAX_EXT_SETS = Math.floor((MAX_BODY_COST - bodyCost(B_350_BODY)) / bodyCost(EXT_SET_ROADS));

function builderBody(energy: number, roads = false): BodyPartConstant[] {
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
  const extSet = roads ? EXT_SET_ROADS : EXT_SET;
  const extEnergy = energy - bodyCost(B_350_BODY);
  const extSets = affordableSets(extEnergy, extSet, 0, MAX_EXT_SETS);
  let body: BodyPartConstant[] = [...B_350_BODY];
  for (let i = 0; i < extSets; i++) {
    body = body.concat(extSet);
  }
  return body;
}

export class Builder extends Role {
  static override readonly priority = 65;
  static override readonly doNotBlockRoads = true;
  // Once every WORK part is destroyed this body can't build or harvest at all — see Role.retreatPart.
  static override readonly retreatPart = WORK;
  static override body(energy: number, ctx?: BodyContext): BodyPartConstant[] {
    return builderBody(energy, ctx?.roads);
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
        // alsoAdjacentRooms: a builder stranded in a Source Keeper room has nothing safe to gather
        // there (no container until the road it's building exists) — falls back to a neighboring room's
        // container/drops rather than self-harvesting a keeper-guarded source. Local energy still wins
        // whenever any exists (see alsoAdjacentRooms' doc in behaviors/types.ts), so this is a no-op for
        // an ordinary well-stocked home-room builder.
        of: [
          { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy", alsoAdjacentRooms: true },
          { find: "dropped", unlessSpawnNeedsEnergy: true, alsoAdjacentRooms: true }
        ],
        prefer: "nearest"
      }
    },
    { do: "harvest", from: { find: "source" } },
    // Building assigns buildTargetRoom to wherever the colony's nearest outstanding site backlog is
    // (home or a remote room); a no-op once already there (moveToRoom completes instantly, falling
    // through to build the same tick). Absent target (no backlog anywhere) makes this step a pure no-op.
    { do: "moveToRoom", to: "buildTargetRoom", avoidDanger: true },
    { do: "build", at: { find: "constructionSite", prefer: "mostProgress" } }
  ];
}
