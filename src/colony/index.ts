// One owned room: its snapshot, operations, and colony-scoped capabilities. Rebuilt fresh every tick.
// Spawning is NOT here — spawn routing is cross-colony, owned by the Empire (see empire/spawning.ts).

import type { Intent } from "../intents/types";
import { operationsFor, type Operation } from "../operations";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { claimsOf, planBuilding, repurposeIdleBuilders, wantedStructures } from "./building";
import { collectMetrics } from "./metrics";
import { visualize } from "./metricsVisual";

export class Colony {
  public readonly operations: Operation[];

  public constructor(public readonly snapshot: ColonySnapshot) {
    this.operations = operationsFor(snapshot.name);
  }

  public get name(): string {
    return this.snapshot.name;
  }

  /** This colony's spawn demand; the empire arbiter sorts and routes across all colonies. Not sorted here. */
  public requests(): CreepRequest[] {
    return this.operations.flatMap(op => op.desiredCreeps(this.snapshot));
  }

  /** The construction arbiter for this colony. */
  public building(): Intent[] {
    return planBuilding(this.snapshot, this.operations);
  }

  /**
   * Repurposes builders left idle once construction is finished — to repairers while anything is decaying,
   * else upgraders. Runs every tick (unlike building(), which is throttled) so a builder converts promptly
   * rather than drop-mining for up to an interval before the next placement pass. Reuses building()'s own
   * operation claims so the "is construction finished" check can't disagree with what would be placed.
   */
  public maintainWorkforce(): Intent[] {
    return repurposeIdleBuilders(this.snapshot, claimsOf(this.snapshot, this.operations));
  }

  /** Collects metrics and returns the roomVisual intent that paints the panel; the only stateful capability (harvest-rate window in Memory). */
  public metrics(): Intent[] {
    const mem = (Memory.metrics[this.name] ??= { harvestSamples: [] });
    // Ungated (throttleGroups: false): the panel wants the full plan across every remote source group,
    // not just the one building() is currently placing — otherwise a finished group's structures would
    // count as built with no target left to compare against.
    const targeted = wantedStructures(this.snapshot, claimsOf(this.snapshot, this.operations), false);
    const report = collectMetrics(
      this.snapshot,
      this.requests(),
      this.operations.map(op => op.name),
      targeted,
      mem,
      this.operations.flatMap(op => op.roleTargets(this.snapshot))
    );
    return [visualize(report)];
  }
}

export function colony(snapshot: ColonySnapshot): Colony {
  return new Colony(snapshot);
}
