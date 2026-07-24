// Upgrading owns the upgrader workforce: how many upgraders given stored energy. Demand only, pure.

import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

const config = {
  // Below this, storage is reserved for other spending; above it, one extra upgrader per 40k stored.
  storageReserve: 100_000,
  storagePerUpgrader: 40_000,
  maxStorageUpgraders: 4,

  // Pre-storage overflow sink: holds at floor while sites are outstanding, then scales with surplus.
  minPreStorageUpgraders: 1,
  surplusPerUpgrader: 1_000 // standing surplus absorbed per extra upgrader
} as const;

function wantedPreStorageUpgraders(colony: ColonySnapshot): number {
  // Only worth spawning once there's energy to draw from (container, drop, or storage/link).
  const standingDrop = colony.drops.reduce((sum, d) => sum + d.amount, 0);
  const containerEnergy = colony.containers.reduce((sum, c) => sum + c.storeEnergy, 0);
  if (standingDrop + containerEnergy <= 0) return 0;

  // Hold at the floor while construction is outstanding: extensions win the energy competition.
  if (colony.constructionProgress > 0) return config.minPreStorageUpgraders;

  // Nothing left to build: absorb the surplus, uncapped (arbiter's affordability guard is the real limit).
  const base = Math.max(config.minPreStorageUpgraders, colony.sources.length);
  const surplusBonus = Math.ceil((standingDrop + containerEnergy) / config.surplusPerUpgrader);
  return base + surplusBonus;
}

function wantedUpgraders(colony: ColonySnapshot): number {
  // With storage, scale with what it holds.
  if (colony.storageEnergy > 0) {
    return Math.min(
      config.maxStorageUpgraders,
      Math.max(0, Math.floor((colony.storageEnergy - config.storageReserve) / config.storagePerUpgrader))
    );
  }
  return wantedPreStorageUpgraders(colony);
}

export class Upgrading extends Operation {
  public readonly kind = "upgrading";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.fillRole(colony, "upgrader", wantedUpgraders(colony), roleDef("upgrader")!.priority);
  }
}
