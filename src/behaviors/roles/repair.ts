import { affordableSets, bodyCost, countPart } from "../../spawn/body";
import { REPAIRABLE } from "../../lib/repairable";
import type { BodyContext, Step } from "../types";
import { Role } from "./role";

// Same WORK/CARRY body shape as the builder it converts from (a converted builder keeps its own body;
// this is only used if a repairer is ever spawned directly). 1:1 weight:MOVE (2 weight parts, 2 MOVE) so
// an off-road repairer — routinely working an unpaved remote route it's the one paving, or a home leg not
// yet built — never fatigues. This is the default until ctx.roads confirms the colony's home leg and
// every selected remote's route are actually built (see bodyContext.ts's allRemoteRoutesBuilt); routeBuilt
// only tracks placement, not decay, so a road worn down enough to need repair still reads as "built" here,
// which is correct — the ratio is about travel speed, not about whether this repairer's own job exists.
const BASE_BODY: BodyPartConstant[] = [WORK, CARRY, MOVE, MOVE];
// 2:1 weight:MOVE once every route is paved, matching builder/upgrader's own road-speed convention.
// Needs two MOVE: WORK+WORK+CARRY is 3 weight parts, and a single MOVE (3:1) still fatigues on a road.
const BASE_BODY_ROADS: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE, MOVE];
// WORK caps at 5 — repair/build/harvest power beyond that is rarely the bottleneck for a role that's
// mostly patching decay, not doing sustained mass construction (that's builder's job). Past this cap,
// only CARRY (and its matching MOVE) keep growing, up to 5 CARRY = 500 capacity, the largest single
// haul worth carrying between an energy source and a repair target before travel time dominates anyway.
const MAX_WORK = 5;
const MAX_CARRY = 5;
// Off-road CARRY/MOVE extension set: 1:1, matching BASE_BODY's ratio.
const CARRY_EXT: BodyPartConstant[] = [CARRY, MOVE];
// On-road CARRY/MOVE extension set: 2:1, matching BASE_BODY_ROADS' ratio.
const CARRY_EXT_ROADS: BodyPartConstant[] = [CARRY, CARRY, MOVE];

function repairBody(energy: number, roads = false): BodyPartConstant[] {
  // BASE_BODY_ROADS costs more than BASE_BODY (350 vs 250) — below that, affordableSets' min:1 floor
  // would hand back a body costing more than energy (unspawnable). Fall back to the cheaper off-road
  // set so a repairer is always spawnable down to RCL1's 300-energy cap, roads or not.
  const set = roads && energy >= bodyCost(BASE_BODY_ROADS) ? BASE_BODY_ROADS : BASE_BODY;
  const workPerSet = countPart(set, WORK);
  const carryPerSet = countPart(set, CARRY);
  // Each base set adds both WORK and CARRY, so the set count is bounded by whichever cap binds first.
  const maxSets = Math.min(Math.floor(MAX_WORK / workPerSet), Math.floor(MAX_CARRY / carryPerSet));
  const sets = affordableSets(energy, set, 1, maxSets);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(set);
  }
  // WORK capped at the base-set stage — keep scaling CARRY/MOVE alone up to MAX_CARRY.
  const carrySoFar = sets * carryPerSet;
  const remainingCarry = MAX_CARRY - carrySoFar;
  if (remainingCarry > 0) {
    const spent = bodyCost(set) * sets;
    const extSet = roads ? CARRY_EXT_ROADS : CARRY_EXT;
    const extCarryPerSet = countPart(extSet, CARRY);
    const maxExtSets = Math.floor(remainingCarry / extCarryPerSet);
    const extSets = affordableSets(energy - spent, extSet, 0, maxExtSets);
    for (let i = 0; i < extSets; i++) {
      body = body.concat(extSet);
    }
  }
  return body;
}

export class Repair extends Role {
  static override readonly priority = 64; // just below builder; upkeep matters less than new construction
  static override readonly doNotBlockRoads = true;
  // Unarmed and often working alone (remote roads/containers) — retreats from an armed hostile rather
  // than repairing on obliviously. See Role.flee.
  static override readonly flee = true;
  // Once every WORK part is destroyed this body can't repair or harvest at all — see Role.retreatPart.
  static override readonly retreatPart = WORK;
  static override body(energy: number, ctx?: BodyContext): BodyPartConstant[] {
    return repairBody(energy, ctx?.roads);
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
  // alsoAdjacentRooms on structure/dropped mirrors builder.ts's own fix for the identical problem: a
  // repairer stranded in a Source Keeper room (its repairTargetRoom is often a transit road running
  // straight through one — see remote route caching in mining/remoteSources.ts) has nothing safe to
  // gather there either, and would otherwise fall through to self-harvesting a keeper-guarded source with
  // no danger-aware pathing at all. Local energy still wins whenever any exists, so this is a no-op for an
  // ordinary well-stocked home-room repairer.
  static override readonly steps: Step[] = [
    { do: "moveToRoom", to: "repairTargetRoom", avoidDanger: true },
    { do: "repair", at: { find: "structure", type: REPAIRABLE, where: "damaged", repairBelow: 0.5, prefer: "mostDamaged" } },
    { do: "repair", at: { find: "structure", type: REPAIRABLE, where: "damaged", prefer: "nearest" } },
    {
      do: "gather",
      from: {
        find: "any",
        of: [
          { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy", alsoAdjacentRooms: true },
          { find: "dropped", alsoAdjacentRooms: true },
          { find: "tombstone" },
          { find: "ruin" }
        ],
        prefer: "nearest"
      }
    },
    { do: "harvest", from: { find: "source" } }
  ];
}
