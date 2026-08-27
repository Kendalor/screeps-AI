// The Empire wraps the whole snapshot, owns the colony list, and holds cross-colony capabilities:
// spawn arbitration and creep behaviour dispatch. Pure EmpireSnapshot -> Empire.

import { colony, type Colony } from "../colony";
import type { Intent } from "../intents/types";
import type { EmpireSnapshot } from "../snapshot/types";
import { runCreepBehaviors } from "./creeps";
import { planSpawning, type BoostStockOf, type RoomDistance } from "./spawning";

export class Empire {
  public readonly colonies: Colony[];

  public constructor(public readonly snapshot: EmpireSnapshot) {
    this.colonies = snapshot.colonies.map(s => colony(s, snapshot.colonies));
  }

  /** The spawn arbiter: collects every colony's demand and routes it. `boostStockOf` gates a boosted
   * request on its compound actually being available yet (see spawning.ts's own doc) — optional so
   * every other caller of this method keeps today's behavior unchanged. */
  public spawning(roomDistance: RoomDistance, boostStockOf?: BoostStockOf): Intent[] {
    return planSpawning(this.colonies, roomDistance, boostStockOf);
  }

  /** Drives every live creep's behaviour. Acts directly for movement/actions; returns only the squad
   * anchor write-back intents (see empire/creeps.ts's module header). Passes the colonies so the squad
   * pass (ADR 0007) can read each squad-bearing operation's formation state and snapshot.
   * `boostLabIdsByHome` is built here (not inside runCreepBehaviors) because it's the one piece of this
   * call's input that comes from Memory rather than the colonies list itself — each colony's own
   * ColonyMemory.boostLabIds (the LabRunner's persisted lab-identity discovery, colony/index.ts's labs()),
   * keyed by colony room name so a creep's own dispatchCreep lookup (empire/creeps.ts) never crosses
   * colonies. A colony with no boostLabIds yet (not RCL6+, or discovery hasn't landed this tick) simply
   * contributes an empty array, same as the map having no entry at all. */
  public creeps(): Intent[] {
    const boostLabIdsByHome = new Map<string, readonly Id<StructureLab>[]>(
      this.colonies.map(c => [c.name, Memory.colonies[c.name]?.boostLabIds ?? []])
    );
    return runCreepBehaviors(this.colonies, boostLabIdsByHome);
  }
}

export function empire(snapshot: EmpireSnapshot): Empire {
  return new Empire(snapshot);
}
