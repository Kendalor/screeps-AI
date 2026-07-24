import { affordableSets, bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// 2:1 weight:MOVE keeps road speed; needs two MOVE since WORK+WORK+CARRY is 3 weight parts.
const UPGRADER_BASE: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE, MOVE]; // 350
// RCL1 floor: a 300-capacity room can't afford the 350 base, and the spawn arbiter would skip it forever.
const UPGRADER_FLOOR: BodyPartConstant[] = [WORK, CARRY, MOVE, MOVE]; // 250
const UPGRADER_SET: BodyPartConstant[] = [WORK, WORK, MOVE];
const MAX_UPGRADER_SETS = 7;

function upgraderBody(energy: number): BodyPartConstant[] {
  if (energy < bodyCost(UPGRADER_BASE)) return [...UPGRADER_FLOOR];

  const spare = Math.max(0, energy - bodyCost(UPGRADER_BASE));
  const sets = affordableSets(spare, UPGRADER_SET, 0, MAX_UPGRADER_SETS);
  let body: BodyPartConstant[] = UPGRADER_BASE;
  for (let i = 0; i < sets; i++) {
    body = body.concat(UPGRADER_SET);
  }
  return body;
}

export class Upgrader extends Role {
  static override readonly priority = 60;
  static override body(energy: number): BodyPartConstant[] {
    return upgraderBody(energy);
  }
  // Upgrade first, then refill from hauler, container, storage, link, or a dropped pile as fallback.
  static override readonly steps: Step[] = [
    { do: "upgrade" },
    { do: "withdraw", from: { find: "creep", role: "hauler", where: "hasEnergy" } },
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_LINK, where: "hasEnergy" } },
    { do: "pickup", from: { find: "dropped", prefer: "largest" } }
  ];
}
