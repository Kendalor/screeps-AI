// Pure: reads the snapshot, returns intents, never touches Game.*.

import type { Colony } from "../colony";
import type { Intent } from "../intents/types";
import { closest } from "../lib/geometry";

export function planDefense({ snapshot }: Colony): Intent[] {
  const out: Intent[] = [];
  if (snapshot.hostiles.length > 0) {
    if (snapshot.towers.length === 0 && snapshot.safeModeAvailable) {
      return [{ kind: "safeMode", room: snapshot.name }];
    }
    for (const tower of snapshot.towers) {
      const target = closest(tower, snapshot.hostiles);
      if (target) out.push({ kind: "towerAttack", tower: tower.id, target: target.id });
    }
  } else {
    for (const tower of snapshot.towers) {
      const hurt = closest(tower, snapshot.woundedFriendlies);
      if (hurt) out.push({ kind: "towerHeal", tower: tower.id, target: hurt.id });
    }
  }
  return out;
}
