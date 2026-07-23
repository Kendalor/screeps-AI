// Defense owns the room's towers and its safemode: attack hostiles, heal wounded friendlies when
// there are none, drop safemode when towerless and invaded. systems/defense.ts was this exact logic
// as a free planner; it becomes an operation because it owns a capability end to end, which is what
// an operation is.
//
// All of it goes through intents(), not desiredCreeps()/structures(): tower fire is direct action
// with no arbiter, and it must run every tick — a hostile that moved last tick needs re-targeting
// this tick. That is precisely the cadence intents() now runs at (tier 1, no interval).
//
// Pure — reads the snapshot, returns plain intents, never touches Game.*.

import type { Intent } from "../intents/types";
import { closest } from "../lib/geometry";
import type { ColonySnapshot } from "../snapshot/types";
import { Operation } from "./operation";

export class Defense extends Operation {
  public readonly kind = "defense";

  public override intents(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = [];
    if (colony.hostiles.length > 0) {
      // Towerless and invaded: safemode is the only defence left, and it is worth more than any
      // partial tower response, so it short-circuits the rest.
      if (colony.towers.length === 0 && colony.safeModeAvailable) {
        return [{ kind: "safeMode", room: colony.name }];
      }
      for (const tower of colony.towers) {
        const target = closest(tower, colony.hostiles);
        if (target) out.push({ kind: "towerAttack", tower: tower.id, target: target.id });
      }
    } else {
      // No hostiles: towers turn to repair-of-flesh, patching wounded friendlies.
      for (const tower of colony.towers) {
        const hurt = closest(tower, colony.woundedFriendlies);
        if (hurt) out.push({ kind: "towerHeal", tower: tower.id, target: hurt.id });
      }
    }
    return out;
  }
}
