// Upgrading owns the upgrader workforce and its infrastructure: how many upgraders given stored
// energy, plus the controller container/road that keeps them fed without a hauler round trip. Pure.

import { roleDef } from "../behaviors/roles";
import GOAL_JSON from "../layouts/Base_2.json";
import { plannedObstacles } from "../layouts/goal";
import { buildCostMatrix, controllerContainerPath } from "../layouts/roads";
import { stampLayout, type PlacedStructure } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import type { XY } from "../lib/geometry";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

const upgraderConfig = {
  // Below this, storage is reserved for other spending; above it, one extra upgrader per 40k stored.
  storageReserve: 100_000,
  storagePerUpgrader: 40_000,
  maxStorageUpgraders: 4,

  // Pre-storage overflow sink: holds at floor while sites are outstanding, then scales with surplus.
  minPreStorageUpgraders: 1,
  surplusPerUpgrader: 1_000, // standing surplus absorbed per extra upgrader

  // Room energyCapacity at which the controller gets its own container + road (RCL2 + all five
  // extensions = 550). Before this the room can't spare the build; after it, the container ends the
  // upgraders' walk to storage.
  containerFromEnergyCapacity: 550
} as const;

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";
const CONTAINER: BuildableStructureConstant = "container";

function wantedPreStorageUpgraders(colony: ColonySnapshot): number {
  // Only worth spawning once there's energy to draw from (container, drop, or storage/link).
  const standingDrop = colony.drops.reduce((sum, d) => sum + d.amount, 0);
  const containerEnergy = colony.containers.reduce((sum, c) => sum + c.storeEnergy, 0);
  if (standingDrop + containerEnergy <= 0) return 0;

  // Hold at the floor while construction is outstanding: extensions win the energy competition.
  if (colony.constructionProgress > 0) return upgraderConfig.minPreStorageUpgraders;

  // Nothing left to build: absorb the surplus, uncapped (arbiter's affordability guard is the real limit).
  const base = Math.max(upgraderConfig.minPreStorageUpgraders, colony.sources.length);
  const surplusBonus = Math.ceil((standingDrop + containerEnergy) / upgraderConfig.surplusPerUpgrader);
  return base + surplusBonus;
}

function wantedUpgraders(colony: ColonySnapshot): number {
  // With storage, scale with what it holds.
  if (colony.storageEnergy > 0) {
    return Math.min(
      upgraderConfig.maxStorageUpgraders,
      Math.max(0, Math.floor((colony.storageEnergy - upgraderConfig.storageReserve) / upgraderConfig.storagePerUpgrader))
    );
  }
  return wantedPreStorageUpgraders(colony);
}

// The tile storage sits on in the bunker goal — known from the anchor before storage is built, so the
// container's road can aim at where storage will be.
function storageTile(anchor: XY): XY | null {
  const storage = GOAL.placements.find(p => p.type === "storage");
  if (!storage) return null;
  return { x: storage.x + anchor.x, y: storage.y + anchor.y };
}

export class Upgrading extends Operation {
  public readonly kind = "upgrading";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.fillRole(colony, "upgrader", wantedUpgraders(colony), roleDef("upgrader")!.priority);
  }

  /**
   * The controller container (within range 2 of the controller, so an upgrader on it stays in upgrade
   * range) and the road linking it to storage. Gated on energyCapacity, not RCL: 550 is RCL2 with all
   * extensions, the point at which the room can spare the build. Claims only — never places sites.
   */
  public override structures(colony: ColonySnapshot, planned: readonly PlacedStructure[] = []): PlacedStructure[] {
    if (colony.energyCapacity < upgraderConfig.containerFromEnergyCapacity || !colony.anchor) return [];

    const from = storageTile(colony.anchor);
    if (!from) return [];

    // Path from the storage tile out to range 2 of the controller against the layout plus siblings'
    // claims, so a shared road is reused rather than duplicated (same reason Mining threads `planned`).
    const costMatrix = buildCostMatrix({
      terrain: colony.terrain,
      structures: [...colony.structures, ...planned]
    });
    const route = controllerContainerPath(from, colony.controller, costMatrix);
    if (!route.structurePos) return [];

    const taken = new Set(planned.map(p => `${p.x},${p.y}`));
    const out: PlacedStructure[] = [];
    const claim = (p: PlacedStructure): void => {
      const key = `${p.x},${p.y}`;
      if (taken.has(key)) return;
      taken.add(key);
      out.push(p);
    };

    claim({ x: route.structurePos.x, y: route.structurePos.y, type: CONTAINER });
    // First tile is the storage side, last is the container — road covers everything between.
    for (const tile of route.path.slice(1, -1)) claim({ x: tile.x, y: tile.y, type: ROAD });
    return out;
  }
}
