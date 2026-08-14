import type { Step } from "../types";
import { Role } from "./role";

// A scout only travels to memory.scoutTarget and idles; the Scouting operation does the rest via intents.
export class Scout extends Role {
  // Below the whole economy (pure future value), but above the floor so a settled colony fields one.
  static override readonly priority = 30;
  static override readonly mover = true;
  static override body(): BodyPartConstant[] {
    return [MOVE];
  }
  static override readonly steps: Step[] = [{ do: "moveToRoom", to: "scoutTarget", avoidDanger: true }];
}
