import type { Step } from "../types";
import { haulerBody } from "./hauler";
import { Role } from "./role";

// Inverse of hauler: moves energy OUT of storage to keep spawning structures full. Container fallback covers a room without storage yet.
export class Supply extends Role {
  static override body(energy: number): BodyPartConstant[] {
    return haulerBody(energy);
  }
  static override readonly steps: Step[] = [
    { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } },
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } }
  ];
}
