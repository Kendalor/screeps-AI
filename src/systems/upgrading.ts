// Upgrader quota, tier 2 (docs/rewrite-skeleton.md §9 P1, ported from
// UpgradeOperation.getMaxUpgraders). Storage energy is the strongest signal
// once it exists; before that, scale cautiously off the room's own energy
// income and controller level so a colony without storage doesn't overspend
// spawn capacity on dedicated upgraders bootstrap creeps already cover.

import type { ColonySnapshot } from "../snapshot/types";

const MIN_ENERGY = 300; // cheapest viable upgrader body: WORK, CARRY, MOVE

// Ported thresholds from UpgradeOperation.getMaxUpgraders: below this, storage
// is reserved for other spending; above it, one extra upgrader per 40k stored.
const STORAGE_RESERVE = 100_000;
const STORAGE_PER_UPGRADER = 40_000;
const MAX_STORAGE_UPGRADERS = 4;

export function desiredUpgraderCount(colony: ColonySnapshot): number {
  if (colony.storageEnergy > 0) {
    return Math.min(
      MAX_STORAGE_UPGRADERS,
      Math.max(0, Math.floor((colony.storageEnergy - STORAGE_RESERVE) / STORAGE_PER_UPGRADER))
    );
  }
  // Below RCL2 bootstrap's own wraparound upgrade step covers it; a dedicated
  // upgrader can't gather on its own yet (no link/storage to withdraw from).
  if (colony.controllerLevel < 2) return 0;
  if (colony.energyAvailable < MIN_ENERGY) return 0;
  return Math.min(colony.controllerLevel, Math.floor(colony.energyAvailable / MIN_ENERGY));
}
