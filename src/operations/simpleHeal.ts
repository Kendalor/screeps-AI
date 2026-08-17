// SimpleHeal: sponsors exactly one SimpleHealerRole creep sent at a single target room
// (ColonyMemory.simpleHeal, snapshot.simpleHeal — a scalar, same "one target per colony" shape as
// Drain's `draining`/Parade's `parading`/SimpleBaitTower's `simpleBaitTower`/Demolish's `demolish`, see
// their headers). Not wired into operationsFor() — no colony gets this by default (see
// operations/index.ts); a colony only carries it while snapshot.simpleHeal is set, attached by Colony's
// constructor exactly like Drain/Parade/SimpleBaitTower/Demolish.
//
// Unlike SimpleBaitTower/Demolish, the spawned creep never tracks the triggering flag's live position —
// its own step table (behaviors/roles/simpleHealer.ts) is Defender-shaped: walk to `targetRoom` (resolved
// ONCE from the flag's own room by empire/simpleHealFlags.ts at handoff time) and heal there, no
// flag-following, no damage-gated retreat. So this operation has no flag name to stamp onto the spawned
// creep's memory at all.
//
// Lifetime is bound in BOTH directions to the flag (see empire/simpleHealFlags.ts) AND to its one creep:
// TODO — decide whether this is a genuine one-shot (like SimpleBaitTower — never replace a dead creep)
// or a headcount to maintain (like Drain/Parade — keep the role staffed while the target's active). Same
// open question as Demolish's — see operations/demolish.ts's header.

import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

export const SIMPLE_HEALER_ROLE = "simpleHealer";

export class SimpleHealOperation extends Operation {
  public readonly kind = "simpleHeal";

  public constructor(room: string, private readonly targetRoom: string) {
    super(room);
  }

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    // TODO — one-shot vs maintained headcount, see file header.
    if (this.owned(colony, SIMPLE_HEALER_ROLE).length >= 1) return [];

    const def = roleDef(SIMPLE_HEALER_ROLE);
    if (!def) return [];
    const body = def.body(colony.energyCapacity, { hasContainer: false, hasLink: false });
    if (body.length === 0) return [];

    return [
      {
        body,
        priority: def.priority,
        memory: { role: SIMPLE_HEALER_ROLE, home: colony.name, op: this.name },
        targetRoom: this.targetRoom,
        spawnRoom: colony.name
      }
    ];
  }

  public override intents(_colony: ColonySnapshot): Intent[] {
    // TODO — mirror SimpleBaitTower's setSimpleHealSpawned/endSimpleHeal latch, or Drain/Parade's
    // simpler "just keep staffing" shape, once the one-shot-vs-maintained question above is settled.
    return [];
  }
}
