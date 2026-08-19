// Transport's full rate-ranked pool (gh #52, ADR 0008/PRD "Pool topology"): every provider/consumer
// graph.ts's transportProviders()/consumers() covered EXCEPT what's Supply's (spawn/extension/tower,
// see supplyRegister.ts) or Steward's (anchor link/storage/terminal triangle, see stewardRegister.ts).
// Self-registration reads live Game.* state directly, same pattern register.ts/supplyRegister.ts/
// stewardRegister.ts already established — no ColonySnapshot indirection (ADR 0008's scoped departure).
//
// Scope, matched against graph.ts's own transportProviders()/consumers() (see that file's PRIORITY
// table and its storageBuffer/supplyProviders/transportProviders split):
//   - source containers' energy output (register.ts's registerMinerContainerOutput — reused, not
//     duplicated), dropped piles/tombstones/ruins (registerGroundEnergy below), remote energy
//     (registerRemoteEnergy below, no room-boundary special case per the PRD), the mineral container
//     (register.ts's registerMineralContainerOutput — reused).
//   - controller container top-up to its fill floor (registerControllerContainerRequest), builder/
//     upgrader battery requests pre-storage only (registerCreepBatteryRequests), storage as the overflow
//     sink for energy AND mineral once it exists (registerStorageSinkRequests).
//   - Deliberately NOT included: storage's drain-for-spawn-need direction (graph.ts's storageBuffer
//     entry) — that's Supply's job, never Transport's (see graph.ts's own transportProviders() doc).
//     Spawn/extension/tower are never registered here at all — Supply's pool owns them exclusively.

import { requestInput, requestOutput, type LogisticsRequest } from "./request";
import { registerMineralContainerOutput, registerMinerContainerOutput } from "./register";

// Same worthwhile bar graph.ts's DROP_WORTHWHILE_FLOOR / topoff.ts's TOPOFF_WORTHWHILE_FLOOR use — a
// dropped pile/tombstone/ruin below this isn't worth a purpose-built trip.
export const DROP_WORTHWHILE_FLOOR = 50;

// The controller container is topped to a floor, not filled to 100%, so an upgrader draining it for
// every last unit doesn't fight a transport creep forever — same floor graph.ts's
// CONTROLLER_CONTAINER_FILL_FLOOR / the old hauler.ts used.
export const CONTROLLER_CONTAINER_FILL_FLOOR = 0.7;
const CONTROLLER_CONTAINER_RANGE = 1; // range of the controller a controller container sits within, Chebyshev

// Only an upgrader actually parked at the controller is a viable creep-sink consumer — one wandering
// off to harvest or in transit isn't upgrading, so topping it up wherever it happens to be just drags a
// transport creep away from the bunker chasing a moving target. Mirrors graph.ts's
// UPGRADER_CONTROLLER_RANGE exactly. Exported so operations/logistics.ts's transportPoolHasConsumer can
// mirror the same range gate instead of a wider one that would over-request transport headcount for an
// upgrader that's technically alive but too far from the controller to ever register a real request here.
export const UPGRADER_CONTROLLER_RANGE = 5;

/**
 * A source's adjacent container's energy output as a withdraw request — register.ts's own
 * registerMinerContainerOutput, re-exported here so every one of Transport's registration functions
 * lives under one import for its planner (transportTaskRunner.ts). `harvestRate` is the source's known
 * saturation rate (see register.ts's own doc) — the caller (transportTaskRunner.ts) sizes it from
 * SOURCE_SATURATING_WORK * HARVEST_POWER, the same way logistics/fleet.ts already prices miner income.
 */
export { registerMinerContainerOutput, registerMineralContainerOutput };

/**
 * Every dropped energy pile, tombstone, and ruin in `room` worth a purpose-built trip
 * (DROP_WORTHWHILE_FLOOR) — mirrors graph.ts's providers() ground-pickup entries exactly (tombstone/ruin
 * gated the same floor, urgency-1-equivalent since these decay; the rate-ranking system prices that
 * urgency itself via amount/distance rather than a separate flag). Energy only, same as graph.ts's own
 * scope — nothing else is ever dropped/entombed/ruined into decay in this codebase yet.
 */
export function registerGroundEnergy(room: Room): LogisticsRequest[] {
  const out: LogisticsRequest[] = [];

  const drops = room.find(FIND_DROPPED_RESOURCES, { filter: d => d.resourceType === RESOURCE_ENERGY });
  for (const d of drops) {
    if (d.amount < DROP_WORTHWHILE_FLOOR) continue;
    out.push(requestOutput(d, RESOURCE_ENERGY, d.amount));
  }

  const tombstones = room.find(FIND_TOMBSTONES);
  for (const t of tombstones) {
    const stored = t.store.getUsedCapacity(RESOURCE_ENERGY);
    if (stored < DROP_WORTHWHILE_FLOOR) continue;
    out.push(requestOutput(t, RESOURCE_ENERGY, stored));
  }

  const ruins = room.find(FIND_RUINS);
  for (const r of ruins) {
    const stored = r.store.getUsedCapacity(RESOURCE_ENERGY);
    if (stored < DROP_WORTHWHILE_FLOOR) continue;
    out.push(requestOutput(r, RESOURCE_ENERGY, stored));
  }

  return out;
}

/**
 * A remote room's container energy as an ordinary withdraw request — no room-boundary special case, no
 * travelHome-style guard (ADR 0008's "drop travelHome's hard reservation-span guard" decision: the
 * targetedBy predicted-amount discount, applied by the caller's ranking pass, is what keeps a remote
 * pickup from over-committing a home consumer, not a refusal to register at all). Same worthwhile floor
 * as a home ground pile. `rooms` is every remote room this colony currently has vision into with a
 * selected/mined source — the caller (transportTaskRunner.ts) supplies live Room objects for whichever
 * remote rooms it can currently see, mirroring register.ts's own "read Game.* directly" idiom.
 */
export function registerRemoteEnergy(rooms: readonly Room[]): LogisticsRequest[] {
  const out: LogisticsRequest[] = [];
  for (const room of rooms) {
    const containers = room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER }) as StructureContainer[];
    for (const c of containers) {
      const stored = c.store.getUsedCapacity(RESOURCE_ENERGY);
      if (stored < DROP_WORTHWHILE_FLOOR) continue;
      out.push(requestOutput(c, RESOURCE_ENERGY, stored));
    }
    const drops = room.find(FIND_DROPPED_RESOURCES, { filter: d => d.resourceType === RESOURCE_ENERGY });
    for (const d of drops) {
      if (d.amount < DROP_WORTHWHILE_FLOOR) continue;
      out.push(requestOutput(d, RESOURCE_ENERGY, d.amount));
    }
    const tombstones = room.find(FIND_TOMBSTONES);
    for (const t of tombstones) {
      const stored = t.store.getUsedCapacity(RESOURCE_ENERGY);
      if (stored < DROP_WORTHWHILE_FLOOR) continue;
      out.push(requestOutput(t, RESOURCE_ENERGY, stored));
    }
    const ruins = room.find(FIND_RUINS);
    for (const r of ruins) {
      const stored = r.store.getUsedCapacity(RESOURCE_ENERGY);
      if (stored < DROP_WORTHWHILE_FLOOR) continue;
      out.push(requestOutput(r, RESOURCE_ENERGY, stored));
    }
  }
  return out;
}

/**
 * The controller container's remaining want toward its fill floor (CONTROLLER_CONTAINER_FILL_FLOOR) — an
 * input request. Mirrors graph.ts's controller-container consumer entry exactly (same floor, same
 * CONTROLLER_CONTAINER_RANGE adjacency gate). `controller` is the room's own controller (required to
 * find "near controller" containers); a room with no controller (shouldn't happen for an owned room) or
 * no container within range yields no request.
 */
export function registerControllerContainerRequest(room: Room, controller: StructureController | undefined): LogisticsRequest | undefined {
  if (!controller) return undefined;
  const containers = controller.pos.findInRange(FIND_STRUCTURES, CONTROLLER_CONTAINER_RANGE, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  }) as StructureContainer[];
  const container = containers[0];
  if (!container) return undefined;

  const capacity = container.store.getCapacity(RESOURCE_ENERGY);
  const floorAmount = Math.floor(capacity * CONTROLLER_CONTAINER_FILL_FLOOR);
  const wanted = floorAmount - container.store.getUsedCapacity(RESOURCE_ENERGY);
  if (wanted <= 0) return undefined;
  return requestInput(container, RESOURCE_ENERGY, wanted);
}

/**
 * Builder/upgrader creeps as direct energy sinks, pre-storage only — mirrors graph.ts's own gate exactly
 * (buildConsumers' `if (!colony.storageId)` block): once storage exists, transport should always feed it
 * instead of hand-feeding creeps directly, so this returns nothing once `hasStorage` is true. An upgrader
 * only counts while parked at the controller (UPGRADER_CONTROLLER_RANGE) — one still travelling or off
 * harvesting isn't a viable delivery target (same reasoning as graph.ts's isNearControllerPos).
 */
export function registerCreepBatteryRequests(creeps: readonly Creep[], controller: StructureController | undefined, hasStorage: boolean): LogisticsRequest[] {
  if (hasStorage) return [];
  const out: LogisticsRequest[] = [];
  for (const creep of creeps) {
    if (creep.memory.role !== "builder" && creep.memory.role !== "upgrader") continue;
    if (creep.memory.role === "upgrader") {
      if (!controller || creep.pos.getRangeTo(controller.pos) > UPGRADER_CONTROLLER_RANGE) continue;
    }
    const wanted = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    if (wanted <= 0) continue;
    out.push(requestInput(creep, RESOURCE_ENERGY, wanted));
  }
  return out;
}

/**
 * Storage as the overflow sink for BOTH energy and mineral, once it exists — mirrors graph.ts's own
 * storage consumer entries exactly (the PRIORITY.storage tier, both the energy and mineral wantedMineral
 * blocks), MINUS the storage-as-SOURCE-for-spawn-deficit direction, which stays Supply's alone (never
 * registered here — see this module's header). `mineral`, when given, is the room's own mineral deposit,
 * used only to know which MineralConstant storage's spare capacity should register a mineral-delivery
 * request for; storage's own free capacity is shared across both resources exactly as graph.ts's
 * wantedMineral computation already accounts for (capacity minus BOTH stored amounts, not per-type).
 */
export function registerStorageSinkRequests(storage: StructureStorage | undefined, mineral: MineralConstant | undefined): LogisticsRequest[] {
  if (!storage) return [];
  const out: LogisticsRequest[] = [];

  const wantedEnergy = storage.store.getFreeCapacity(RESOURCE_ENERGY);
  if (wantedEnergy > 0) out.push(requestInput(storage, RESOURCE_ENERGY, wantedEnergy));

  if (mineral) {
    const wantedMineral = storage.store.getFreeCapacity(mineral);
    if (wantedMineral !== null && wantedMineral > 0) out.push(requestInput(storage, mineral, wantedMineral));
  }

  return out;
}
