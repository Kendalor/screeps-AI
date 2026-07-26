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
  static override body(energy: number): BodyPartConstant[] {
    return haulerBody(energy);
  }
  // Container before drops (concentrated load), storage/spawn/extensions/towers before consumers (last-resort sink).
  static override readonly steps: Step[] = [
    { do: "withdraw", from: { find: "structure", type: [STRUCTURE_CONTAINER], where: "hasEnergy" } },
    { do: "pickup", from: { find: "dropped", prefer: "largest" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_STORAGE], where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_TOWER], where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_EXTENSION], where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_SPAWN], where: "notFull" } },
    // oneShot: a working consumer re-validates as notFull forever, so cap this to one transfer per visit.
    { do: "transfer", to: { find: "creep", role: ["builder", "upgrader"], where: "notFull", prefer: "nearest" }, oneShot: true }
  ];
}
