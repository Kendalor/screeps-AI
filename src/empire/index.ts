// The Empire wraps the whole snapshot, owns the colony list, and holds cross-colony capabilities:
// spawn arbitration and creep behaviour dispatch. Pure EmpireSnapshot -> Empire.

import { colony, type Colony } from "../colony";
import type { Intent } from "../intents/types";
import type { EmpireSnapshot } from "../snapshot/types";
import { runCreepBehaviors } from "./creeps";
import { planSpawning, type RoomDistance } from "./spawning";

export class Empire {
  public readonly colonies: Colony[];

  public constructor(public readonly snapshot: EmpireSnapshot) {
    this.colonies = snapshot.colonies.map(s => colony(s, snapshot.colonies));
  }

  /** The spawn arbiter: collects every colony's demand and routes it. */
  public spawning(roomDistance: RoomDistance): Intent[] {
    return planSpawning(this.colonies, roomDistance);
  }

  /** Drives every live creep's behaviour. Acts directly for movement/actions; returns only the squad
   * anchor write-back intents (see empire/creeps.ts's module header). Passes the colonies so the squad
   * pass (ADR 0007) can read each squad-bearing operation's formation state and snapshot. */
  public creeps(): Intent[] {
    return runCreepBehaviors(this.colonies);
  }
}

export function empire(snapshot: EmpireSnapshot): Empire {
  return new Empire(snapshot);
}
