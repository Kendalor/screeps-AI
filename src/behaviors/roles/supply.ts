import type { Step } from "../types";
import { haulerBody } from "./hauler";
import { Role } from "./role";

// Inverse of hauler: moves energy OUT of storage to keep spawning structures full. Container fallback covers a room without storage yet.
export class Supply extends Role {
  static override readonly priority = 100; // highest non-recovery priority: a starved spawn stalls the whole colony, and supply is what refills extensions from storage so bigger bodies (miners/haulers sized off capacity) ever become affordable
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return haulerBody(energy);
  }
  static override readonly steps: Step[] = [
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_EXTENSION], where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_SPAWN], where: "notFull" } },
    { do: "withdraw", from: { find: "structure", type: [STRUCTURE_STORAGE], where: "hasEnergy" } },
    // Source containers only — draining the controller container would undo the hauler that fills it.
    { do: "withdraw", from: { find: "structure", type: [STRUCTURE_CONTAINER], where: "hasEnergy", near: "notController" } }
  ];
}
