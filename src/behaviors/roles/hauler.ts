import { affordableSets } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// 1:1 CARRY:MOVE so a loaded hauler never fatigues, even off-road.
const HAULER_SET: BodyPartConstant[] = [CARRY, MOVE];
const MAX_HAULER_SETS = 25; // 25 sets = 50 parts, the hard body cap

export function haulerBody(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, HAULER_SET, 1, MAX_HAULER_SETS);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(HAULER_SET);
  }
  return body;
}

export class Hauler extends Role {
  static override readonly priority = 90;
  // Sweep loose piles passed near while travelling to a far miner container, so energy doesn't decay.
  static override readonly sweep = true;
  static override body(energy: number): BodyPartConstant[] {
    return haulerBody(energy);
  }
  // Source containers (near: "notController" — never the controller container, which the hauler FILLS
  // rather than drains) and drops pooled into one gather, ranked by largest load.
  //
  // Deliver order is a pre-/post-storage phase switch achieved purely by ordering (the interpreter runs
  // the first step whose target resolves, skipping the rest): spawn + extensions come FIRST, because a
  // room that can't spawn is dead. Pre-storage there is no supply unit, so the hauler is the only thing
  // that fills them — putting the controller container ahead of them (its old position) let that 2000-cap
  // sink soak the whole load and the spawn structures never filled, stalling replacements into a wipe.
  // Post-storage the supply unit keeps spawn+extensions full, so those steps find nothing (notFull) and
  // the hauler falls straight through to the controller container (topped to a 0.7 floor so upgraders
  // stay fed) and then storage — exactly the intended post-storage behaviour. Tower, then a consumer
  // creep (last-resort sink), come last in both phases.
  static override readonly steps: Step[] = [
    {
      do: "gather",
      from: {
        find: "any",
        of: [
          { find: "structure", type: [STRUCTURE_CONTAINER], where: "hasEnergy", near: "notController" },
          { find: "dropped" },
          { find: "tombstone" }
        ],
        prefer: "largest"
      }
    },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_SPAWN, STRUCTURE_EXTENSION], where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_CONTAINER], where: "notFull", near: "controller", fillTo: 0.7 } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_STORAGE], where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_TOWER], where: "notFull" } },
    // oneShot: a working consumer re-validates as notFull forever, so cap this to one transfer per visit.
    { do: "transfer", to: { find: "creep", role: ["builder", "upgrader"], where: "notFull", prefer: "nearest" }, oneShot: true }
  ];
}
