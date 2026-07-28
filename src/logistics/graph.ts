// The provider/consumer graph: pure functions over ColonySnapshot -> data, the reusable abstraction
// legacy's RoomLogisticsOperation gestured at (LogisticTask{from,to,amount,type}) but never wired up.
// Reuses targets.ts's belowFillTo/isWorthwhile-shaped math so "is this container full/worth a trip" is
// asked once, not reinvented here — same reasoning, snapshot-pure instead of live-object.

import type { ColonySnapshot, SnapContainer, SnapDrop } from "../snapshot/types";
import type { NodeRef } from "./types";

export interface Provider {
  ref: NodeRef;
  resource: ResourceConstant;
  available: number; // energy sitting there right now
  urgency: number; // decay risk / overflow risk — dropped piles and near-full containers rank high
}

export interface Consumer {
  ref: NodeRef;
  resource: ResourceConstant;
  wanted: number; // free capacity, capped by fillTo-equivalent floors
  priority: number; // spawn/extension > controller-container-floor > storage > tower > creep sink
}

// Mirrors hauler.ts's step order (spawn/ext first, then controller-container to a floor, then
// storage/tower/creep sink) — this graph is a new, additive consumer of that knowledge, not a rewrite
// of hauler.ts, which stays live during the A/B (see docs/logistics-plan.md).
const PRIORITY = {
  spawnSystem: 100,
  controllerContainer: 80
} as const;

// The controller container is topped to a floor (not filled to 100%) so upgraders draining it for
// every last unit don't fight a transport creep forever — same floor hauler.ts already uses.
const CONTROLLER_CONTAINER_FILL_FLOOR = 0.7;

// A dropped pile below this floor isn't worth a purpose-built trip — same bar targets.ts's
// isWorthwhile applies per-creep, translated to an absolute colony-level floor since a Provider has no
// creep to size "worthwhile" against.
const DROP_WORTHWHILE_FLOOR = 50;

const CONTROLLER_CONTAINER_RANGE = 2; // range of the controller a controller container sits within

function isNearController(colony: ColonySnapshot, c: SnapContainer): boolean {
  const dx = c.x - colony.controller.x;
  const dy = c.y - colony.controller.y;
  return Math.max(Math.abs(dx), Math.abs(dy)) <= CONTROLLER_CONTAINER_RANGE;
}

/** Source containers (never the controller's) with energy, plus dropped piles worth a trip. */
export function providers(colony: ColonySnapshot): Provider[] {
  const out: Provider[] = [];

  for (const c of colony.containers) {
    if (isNearController(colony, c)) continue; // the controller container is a consumer, not a source
    if (c.storeEnergy <= 0) continue;
    out.push({
      ref: { kind: "structure", id: c.id as Id<AnyStoreStructure> },
      resource: RESOURCE_ENERGY,
      available: c.storeEnergy,
      urgency: c.storeCapacity > 0 ? c.storeEnergy / c.storeCapacity : 0
    });
  }

  for (const d of colony.drops) {
    if (!isWorthwhileDrop(d)) continue;
    out.push({
      ref: { kind: "dropped", id: d.id },
      resource: RESOURCE_ENERGY,
      available: d.amount,
      urgency: 1 // ground energy decays — always treated as urgent once past the worthwhile floor
    });
  }

  return out;
}

function isWorthwhileDrop(d: SnapDrop): boolean {
  return d.amount >= DROP_WORTHWHILE_FLOOR;
}

/** Spawn/extensions as one aggregate node, plus the controller container while below its fill floor. */
export function consumers(colony: ColonySnapshot): Consumer[] {
  const out: Consumer[] = [];

  const spawnWanted = colony.energyCapacity - colony.energyAvailable;
  if (spawnWanted > 0) {
    out.push({
      ref: { kind: "spawnSystem" },
      resource: RESOURCE_ENERGY,
      wanted: spawnWanted,
      priority: PRIORITY.spawnSystem
    });
  }

  for (const c of colony.containers) {
    if (!isNearController(colony, c)) continue;
    const floorAmount = Math.floor(c.storeCapacity * CONTROLLER_CONTAINER_FILL_FLOOR);
    const wanted = floorAmount - c.storeEnergy;
    if (wanted <= 0) continue;
    out.push({
      ref: { kind: "structure", id: c.id as Id<AnyStoreStructure> },
      resource: RESOURCE_ENERGY,
      wanted,
      priority: PRIORITY.controllerContainer
    });
  }

  return out;
}
