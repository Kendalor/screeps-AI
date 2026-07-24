import type { Step } from "../types";
import { Role } from "./role";

// A scout only travels: it walks to whatever room the Scouting operation assigned via
// memory.scoutTarget, following the precomputed route, and idles once there. The operation does the
// rest — recording what the scout sees and assigning the next target — through intents, so the
// creep itself needs no work parts and no logic beyond "go to the room I was told to."
export class Scout extends Role {
  // Below the whole economy: a scout is a single cheap MOVE and pure future value (vision for remote
  // mining/expansion), so it yields every spawn to a creep that produces or builds now. It still sits
  // above the floor so a settled colony with spare energy does eventually field one.
  static override readonly priority = 30;
  static override body(): BodyPartConstant[] {
    return [MOVE];
  }
  static override readonly steps: Step[] = [{ do: "moveToRoom", to: "scoutTarget" }];
}
