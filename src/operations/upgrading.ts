// Upgrading owns the upgrader workforce: how many upgraders the colony should field given its
// stored energy. Demand only — its creeps run the upgrade role's step loop, and it places no
// structures and takes no direct action. The quota is ported verbatim from systems/upgrading.ts.
//
// Pure — reads the snapshot, returns plain requests, never touches Game.*.

import { orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";
import { DEFAULT_PRIORITY, fillTo, type CreepRequest } from "../spawn/request";
import { bodyContext } from "../behaviors/bodyContext";
import { Operation } from "./operation";

// Below this, storage is reserved for other spending; above it, one extra upgrader per 40k stored.
const STORAGE_RESERVE = 100_000;
const STORAGE_PER_UPGRADER = 40_000;
const MAX_STORAGE_UPGRADERS = 4;

// Pre-storage, upgrading leads the RCL climb, so the colony always fields a small dedicated squad
// rather than none. It scales 1–3 with the harvestable income (more sources ⇒ more energy to spend
// on the controller). The upgrader role pulls this energy from mining containers and ground drops
// (see roles.ts) — with no container yet it draws from the drop piles the miners leave.
const MIN_PRE_STORAGE_UPGRADERS = 1;
const MAX_PRE_STORAGE_UPGRADERS = 3;

function wantedPreStorageUpgraders(colony: ColonySnapshot): number {
  // A dedicated upgrader is only worth spawning once there is somewhere for it to get energy: a
  // mining container, a ground drop, or (with storage) the storage/link path. At room start the
  // drop-miners' ground piles are that source, so an upgrader is viable from RCL1 — it is what makes
  // the controller climb from level 1 at all now that bootstrap no longer upgrades on the side.
  const hasEnergySource = colony.containers.some(c => c.storeEnergy > 0) || colony.drops.length > 0;
  if (!hasEnergySource) return 0;

  return Math.min(
    MAX_PRE_STORAGE_UPGRADERS,
    Math.max(MIN_PRE_STORAGE_UPGRADERS, colony.sources.length)
  );
}

function wantedUpgraders(colony: ColonySnapshot): number {
  // With storage, scale with what it holds — the steady-state formula, unchanged.
  if (colony.storageEnergy > 0) {
    return Math.min(
      MAX_STORAGE_UPGRADERS,
      Math.max(0, Math.floor((colony.storageEnergy - STORAGE_RESERVE) / STORAGE_PER_UPGRADER))
    );
  }
  // Pre-storage: a small dedicated squad, leading the early-game climb.
  return wantedPreStorageUpgraders(colony);
}

export class Upgrading extends Operation {
  public readonly kind = "upgrading";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return fillTo(
      wantedUpgraders(colony),
      // This operation's upgraders — one Upgrading per colony today, but scoped by op so a second
      // never miscounts against the first.
      this.owned(colony, "upgrader").length,
      orderBody(roleDef("upgrader")?.body(colony.energyCapacity, bodyContext(colony)) ?? []),
      DEFAULT_PRIORITY.upgrader,
      { role: "upgrader", home: colony.name, op: this.name }
    );
  }
}
