// The Empire wraps the whole snapshot, owns the colony list, and holds the cross-colony
// capabilities: spawn arbitration (routing a request to the nearest spawn-capable colony) and creep
// behaviour dispatch. Pure EmpireSnapshot -> Empire: buildEmpireSnapshot() stays the sole Game.*
// boundary, so the entire hierarchy is constructible from a fixture.
//
// A class with methods, like Colony — the capabilities that were empire-scoped systems now live
// where they belong. `spawning()` takes a room-distance function so it stays testable without Game;
// `creeps()` is the one capability that genuinely needs Game (it drives live creeps), and it is
// isolated in empire/creeps.ts.

import { colony, type Colony } from "../colony";
import type { Intent } from "../intents/types";
import type { EmpireSnapshot } from "../snapshot/types";
import { runCreepBehaviors } from "./creeps";
import { planSpawning, type RoomDistance } from "./spawning";

export class Empire {
  public readonly colonies: Colony[];

  public constructor(public readonly snapshot: EmpireSnapshot) {
    this.colonies = snapshot.colonies.map(colony);
  }

  /** The spawn arbiter: collects every colony's demand and routes it. */
  public spawning(roomDistance: RoomDistance): Intent[] {
    return planSpawning(this.colonies, roomDistance);
  }

  /** Drives every live creep's behaviour. Acts directly; returns no intents. */
  public creeps(): void {
    runCreepBehaviors();
  }
}

export function empire(snapshot: EmpireSnapshot): Empire {
  return new Empire(snapshot);
}
