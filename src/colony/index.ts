// A Colony is one owned room: its snapshot, the operations it runs, and the colony-scoped
// capabilities that arbitrate over them. Constructed fresh every tick — snapshot and operations
// both rebuilt from scratch, no state carried across ticks.
//
// A class with methods, amending ADR 0005 stage 1's "Colony is `{snapshot}` and nothing else, no
// methods." That constraint was about not baking per-system dispatch into a premature `plan()`;
// stage 3 always intended capabilities to land here. `building()` and `requests()` are those
// capabilities — the construction arbiter and the demand this colony emits. What does NOT live here
// is spawning: energy and spawns are per-room but spawn *routing* is cross-colony, so the arbiter
// is the Empire's (see empire/spawning.ts). A colony only states what it wants.

import type { Intent } from "../intents/types";
import { operationsFor, type Operation } from "../operations";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { planBuilding } from "./building";
import { bootstrapRequests, builderRequests, recoveryRequests } from "./requests";

export class Colony {
  public readonly operations: Operation[];

  public constructor(public readonly snapshot: ColonySnapshot) {
    this.operations = operationsFor(snapshot.name);
  }

  public get name(): string {
    return this.snapshot.name;
  }

  /**
   * Everything this colony wants spawned: its operations' demand, plus the roles no operation owns
   * yet (recovery, bootstrap, builder). The empire arbiter collects this across all colonies, sorts
   * by priority and routes. Nothing here spawns — a colony states demand, it does not decide.
   *
   * A colony-wide priority sort is deliberately NOT done here: merging happens in the arbiter, which
   * sees every colony's requests at once, so one colony cannot pre-empt another's ordering.
   */
  public requests(): CreepRequest[] {
    return [
      ...this.operations.flatMap(op => op.desiredCreeps(this.snapshot)),
      ...recoveryRequests(this.snapshot),
      ...bootstrapRequests(this.snapshot),
      ...builderRequests(this.snapshot)
    ];
  }

  /** The construction arbiter for this colony. */
  public building(): Intent[] {
    return planBuilding(this.snapshot, this.operations);
  }
}

export function colony(snapshot: ColonySnapshot): Colony {
  return new Colony(snapshot);
}
