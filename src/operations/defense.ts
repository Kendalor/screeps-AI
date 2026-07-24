// Defense owns towers and safemode: attack hostiles, heal friendlies otherwise, safemode when towerless and invaded.
// Goes through intents() not desiredCreeps(): tower fire is direct action that must run every tick, untiered.

import type { Intent } from "../intents/types";
import { closest } from "../lib/geometry";
import type { ColonySnapshot } from "../snapshot/types";
import { Operation } from "./operation";

export class Defense extends Operation {
  public readonly kind = "defense";

  public override intents(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = [];
    if (colony.hostiles.length > 0) {
      // Towerless and invaded: safemode is the only defence left, so it short-circuits the rest.
      if (colony.towers.length === 0 && colony.safeModeAvailable) {
        return [{ kind: "safeMode", room: colony.name }];
      }
      for (const tower of colony.towers) {
        const target = closest(tower, colony.hostiles);
        if (target) out.push({ kind: "towerAttack", tower: tower.id, target: target.id });
      }
    } else {
      // No hostiles: towers heal wounded friendlies instead.
      for (const tower of colony.towers) {
        const hurt = closest(tower, colony.woundedFriendlies);
        if (hurt) out.push({ kind: "towerHeal", tower: tower.id, target: hurt.id });
      }
    }
    return out;
  }
}
