// Pure: reads the snapshot, returns intents, never touches Game.*.

import type { Intent } from "../intents/types";
import { closest } from "../lib/geometry";
import type { EmpireSnapshot } from "../snapshot/types";

export function planDefense(snap: EmpireSnapshot): Intent[] {
  const out: Intent[] = [];
  for (const colony of snap.colonies) {
    if (colony.hostiles.length > 0) {
      if (colony.towers.length === 0 && colony.safeModeAvailable) {
        out.push({ kind: "safeMode", room: colony.name });
        continue;
      }
      for (const tower of colony.towers) {
        const target = closest(tower, colony.hostiles);
        if (target) out.push({ kind: "towerAttack", tower: tower.id, target: target.id });
      }
    } else {
      for (const tower of colony.towers) {
        const hurt = closest(tower, colony.woundedFriendlies);
        if (hurt) out.push({ kind: "towerHeal", tower: tower.id, target: hurt.id });
      }
    }
  }
  return out;
}
