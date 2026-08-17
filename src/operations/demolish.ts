// Demolish: sponsors exactly one DemolisherRole creep sent at a single target room
// (ColonyMemory.demolish, snapshot.demolish — a scalar, same "one target per colony" shape
// as Drain's `draining`/Parade's `parading`/SimpleBaitTower's `simpleBaitTower`, see their headers). Not
// wired into operationsFor() — no colony gets this by default (see operations/index.ts); a colony only
// carries it while snapshot.demolish is set, attached by Colony's constructor exactly like Drain/Parade/
// SimpleBaitTower.
//
// Lifetime is bound in BOTH directions to the flag (see empire/demolishFlags.ts) AND to its one creep:
// TODO — decide whether this is a genuine one-shot (like SimpleBaitTower — never replace a dead creep)
// or a headcount to maintain (like Drain/Parade — keep the role staffed while the target's active).
//
// The demolisher creep's own step table lives in its own file — see behaviors/roles/demolisher.ts.

import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

export const DEMOLISHER_ROLE = "demolisher";

export class DemolishOperation extends Operation {
  public readonly kind = "demolish";

  public constructor(
    room: string,
    private readonly targetRoom: string,
    // The originating flag's NAME (ColonyMemory.demolishFlag/snapshot.demolishFlag), stamped onto the
    // spawned creep's own memory below (CreepMemory.followFlag — the field every flag-following role
    // shares, see its doc) — see SimpleBaitTowerOperation's constructor doc for the same pattern.
    // Optional for the same same-tick-handoff reason.
    private readonly flagName?: string
  ) {
    super(room);
  }

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    // TODO — one-shot vs maintained headcount, see file header.
    if (this.owned(colony, DEMOLISHER_ROLE).length >= 1) return [];

    const def = roleDef(DEMOLISHER_ROLE);
    if (!def) return [];
    const body = def.body(colony.energyCapacity, { hasContainer: false, hasLink: false });
    if (body.length === 0) return [];

    return [
      {
        body,
        priority: def.priority,
        memory: { role: DEMOLISHER_ROLE, home: colony.name, op: this.name, followFlag: this.flagName },
        targetRoom: this.targetRoom,
        spawnRoom: colony.name
      }
    ];
  }

  public override intents(_colony: ColonySnapshot): Intent[] {
    // TODO — mirror SimpleBaitTower's setDemolishSpawned/endDemolish latch, or Drain/Parade's simpler
    // "just keep staffing" shape, once the one-shot-vs-maintained question above is settled.
    return [];
  }
}
