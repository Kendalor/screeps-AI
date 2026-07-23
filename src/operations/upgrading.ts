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

// Pre-storage, upgrading is the *overflow* sink: it keeps harvested energy from rotting, but only
// after construction has taken what it needs. Building an extension compounds (every future body
// grows), so while sites are outstanding the squad holds at a floor — enough to keep the controller
// from downgrading, not enough to starve the builders. Once construction is clear the squad scales
// with the standing surplus to absorb whatever the room over-produces.
const MIN_PRE_STORAGE_UPGRADERS = 1;
// Each extra upgrader is meant to absorb roughly this much standing surplus. One upgrader consumes on
// the order of a few energy/tick at the controller, so a growing ground pile past this justifies one.
const SURPLUS_PER_UPGRADER = 1_000;

function wantedPreStorageUpgraders(colony: ColonySnapshot): number {
  // A dedicated upgrader is only worth spawning once there is somewhere for it to get energy: a
  // mining container, a ground drop, or (with storage) the storage/link path. At room start the
  // drop-miners' ground piles are that source, so an upgrader is viable from RCL1 — it is what makes
  // the controller climb from level 1 at all now that bootstrap no longer upgrades on the side.
  const standingDrop = colony.drops.reduce((sum, d) => sum + d.amount, 0);
  const containerEnergy = colony.containers.reduce((sum, c) => sum + c.storeEnergy, 0);
  if (standingDrop + containerEnergy <= 0) return 0;

  // While construction is outstanding, hold at the floor: extensions win the energy competition
  // because completing one lifts the whole room past 300 capacity. Measured: with upgraders scaling
  // up here, they ate the drops and the room could not finish a single extension.
  if (colony.constructionProgress > 0) return MIN_PRE_STORAGE_UPGRADERS;

  // Nothing left to build: absorb the surplus. Base one per source, plus one per SURPLUS_PER_UPGRADER
  // of energy sitting unspent. No cap — the controller is bottomless and the arbiter's affordability
  // guard is the real limit on headcount.
  const base = Math.max(MIN_PRE_STORAGE_UPGRADERS, colony.sources.length);
  const surplusBonus = Math.ceil((standingDrop + containerEnergy) / SURPLUS_PER_UPGRADER);
  return base + surplusBonus;
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
