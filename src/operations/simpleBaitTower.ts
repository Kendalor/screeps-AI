// SimpleBaitTower: sponsors exactly one SimpleBaitTowerRole creep sent at a single target room
// (ColonyMemory.simpleBaitTower, snapshot.simpleBaitTower — a scalar, same "one target per colony" shape
// as Drain's `draining`/Parade's `parading`, see their headers). Not wired into operationsFor() — no
// colony gets this by default (see operations/index.ts); a colony only carries it while
// snapshot.simpleBaitTower is set, attached by Colony's constructor exactly like Drain/Parade.
//
// Lifetime is bound in BOTH directions to the flag (see empire/simpleBaitTowerFlags.ts) AND to its one
// creep: this is a genuine one-shot, not a headcount to maintain. Exactly one creep is ever spawned —
// once snapshot.simpleBaitTowerSpawned latches true (set the first tick a creep is owned), desiredCreeps
// never requests again, even after that creep dies. A death after spawning is read as the operation
// having run its course: intents() emits endSimpleBaitTower to detach the operation itself (clears
// simpleBaitTower/simpleBaitTowerSpawned but deliberately leaves simpleBaitTowerFlag on record —
// simpleBaitTowerFlags.ts's own pass removes the now-orphaned physical flag next tick, same as a player
// removing the flag would stop this operation). Neither path ever tries to replace a dead bait creep.
//
// The bait creep's own enter/retreat/heal/re-enter behavior lives in its own step table — see
// behaviors/roles/simpleBaitTower.ts.

import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import { orderBody } from "../spawn/body";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

export const SIMPLE_BAIT_TOWER_ROLE = "simpleBaitTower";

export class SimpleBaitTowerOperation extends Operation {
  public readonly kind = "simpleBaitTower";

  public constructor(
    room: string,
    private readonly targetRoom: string
  ) {
    super(room);
  }

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    // Already spawned once (whether it's still alive or has since died): never request a second bait
    // creep — see file header for why a death after spawning terminates the op instead of replacing it.
    if (colony.simpleBaitTowerSpawned) return [];
    if (this.owned(colony, SIMPLE_BAIT_TOWER_ROLE).length >= 1) return [];

    const def = roleDef(SIMPLE_BAIT_TOWER_ROLE);
    if (!def) return [];
    const body = orderBody(def.body(colony.energyCapacity, { hasContainer: false, hasLink: false }));
    if (body.length === 0) return [];

    return [
      {
        body,
        priority: def.priority,
        memory: { role: SIMPLE_BAIT_TOWER_ROLE, home: colony.name, op: this.name },
        targetRoom: this.targetRoom,
        spawnRoom: colony.name
      }
    ];
  }

  public override intents(colony: ColonySnapshot): Intent[] {
    const owned = this.owned(colony, SIMPLE_BAIT_TOWER_ROLE);

    // First tick the creep is alive: latch simpleBaitTowerSpawned so desiredCreeps never fires again,
    // even across the tick boundary where this creep eventually dies.
    if (owned.length > 0 && !colony.simpleBaitTowerSpawned) {
      return [{ kind: "setSimpleBaitTowerSpawned", room: colony.name }];
    }

    // Spawned once already, and now nothing's left alive: the bait creep died (or, on the very first
    // tick after a same-tick spawn+death, never got to act) — the operation's job is done either way.
    // Self-terminate; simpleBaitTowerFlags.ts removes the now-orphaned flag next tick (see file header).
    if (colony.simpleBaitTowerSpawned && owned.length === 0) {
      return [{ kind: "endSimpleBaitTower", room: colony.name }];
    }

    return [];
  }
}
