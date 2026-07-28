// Defense owns towers and safemode: attack hostiles, heal friendlies otherwise, safemode when towerless and invaded.
// Goes through intents() not desiredCreeps(): tower fire is direct action that must run every tick, untiered.

import type { Intent } from "../intents/types";
import { closest, range } from "../lib/geometry";
import { needsRepair } from "../lib/repairable";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";
import { Operation } from "./operation";

// Beyond this range a tower's repair falloff (TOWER_OPTIMAL_RANGE = 5) has already started eating into
// its output, so structure upkeep past it is left for a repairer creep instead — a creep's WORK part
// repairs at a flat rate regardless of distance, unlike a tower's. Exported so Repairing can tell
// whether a given decayed structure is tower-covered before requesting a dedicated repairer for it.
export const TOWER_REPAIR_RANGE = 6;

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
      return out;
    }
    // No hostiles: heal a wounded friendly first — rarer and time-critical — else repair the closest
    // decayed structure still within efficient tower range.
    for (const tower of colony.towers) {
      const hurt = closest(tower, colony.woundedFriendlies);
      if (hurt) {
        out.push({ kind: "towerHeal", tower: tower.id, target: hurt.id });
        continue;
      }
      const decayed = closestRepairable(tower, colony.structures);
      if (decayed?.id) out.push({ kind: "towerRepair", tower: tower.id, target: decayed.id });
    }
    return out;
  }
}

function closestRepairable(from: { x: number; y: number }, structures: readonly SnapStructure[]): SnapStructure | undefined {
  return closest(from, structures.filter(s => isTowerRepairable(s) && range(from, s) <= TOWER_REPAIR_RANGE));
}

function isTowerRepairable(s: SnapStructure): boolean {
  return s.hits !== undefined && s.hitsMax !== undefined && needsRepair(s.type, s.hits, s.hitsMax);
}

// Whether a tower already covers this decayed structure — Repairing skips requesting a creep for it if so.
export function coveredByTower(colony: ColonySnapshot, structure: SnapStructure): boolean {
  return colony.towers.some(t => range(t, structure) <= TOWER_REPAIR_RANGE);
}
