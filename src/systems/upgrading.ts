import type { ColonySnapshot } from "../snapshot/types";

// Below this, storage is reserved for other spending; above it, one extra upgrader per 40k stored.
const STORAGE_RESERVE = 100_000;
const STORAGE_PER_UPGRADER = 40_000;
const MAX_STORAGE_UPGRADERS = 4;

export function desiredUpgraderCount(colony: ColonySnapshot): number {
  // The upgrader role has no harvest step, so without storage/link to withdraw from it just wanders inert.
  if (colony.storageEnergy <= 0) return 0;
  return Math.min(
    MAX_STORAGE_UPGRADERS,
    Math.max(0, Math.floor((colony.storageEnergy - STORAGE_RESERVE) / STORAGE_PER_UPGRADER))
  );
}
