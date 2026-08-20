// Transport's full rate-ranked pool (gh #52, ADR 0008/PRD "Pool topology"): every provider/consumer
// graph.ts's transportProviders()/consumers() covered EXCEPT what's Supply's (spawn/extension/tower,
// see supplyRegister.ts) or Steward's (anchor link/storage/terminal triangle, see stewardRegister.ts).
// Self-registration reads live Game.* state directly, same pattern register.ts/supplyRegister.ts/
// stewardRegister.ts already established — no ColonySnapshot indirection (ADR 0008's scoped departure).
//
// Scope, matched against graph.ts's own transportProviders()/consumers() (see that file's PRIORITY
// table and its storageBuffer/supplyProviders/transportProviders split):
//   - source containers' energy output (register.ts's registerMinerContainerOutput — reused, not
//     duplicated), dropped piles/tombstones/ruins of ANY resource (registerGroundResources below),
//     remote ground resources (registerRemoteGroundResources below, no room-boundary special case per
//     the PRD), the mineral container (register.ts's registerMineralContainerOutput — reused).
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

/** Every ResourceConstant a store-bearing object (tombstone/ruin) currently holds any amount of. */
function storedResources(store: Store<ResourceConstant, false>): ResourceConstant[] {
  return (Object.keys(store) as ResourceConstant[]).filter(r => store.getUsedCapacity(r) > 0);
}

/**
 * One dropped pile/tombstone/ruin's worth of output requests, gated on the TILE'S TOTAL across every
 * resource it holds (not any single resource's own amount) — a tombstone carrying 10 energy plus 400 of a
 * high-value boost compound is worth a trip even though neither line item alone clears
 * DROP_WORTHWHILE_FLOOR; a dead boosted fighter's loaded compounds are exactly the case this exists for.
 * Still emits one LogisticsRequest per resource type present (never a combined multi-resource request —
 * see this module's header): request.ts/greedyMatch.ts/the live withdraw Task are all single-resource by
 * design, matching a real withdraw() engine call, so the aggregation only ever affects the gate, never the
 * request shape itself. A dropped pile only ever holds one resourceType, so its own total IS that amount.
 */
function groundRequestsFor(target: Resource | Tombstone | Ruin): LogisticsRequest[] {
  if ("resourceType" in target) {
    return target.amount >= DROP_WORTHWHILE_FLOOR ? [requestOutput(target, target.resourceType, target.amount)] : [];
  }
  const resources = storedResources(target.store);
  const total = resources.reduce((sum, r) => sum + target.store.getUsedCapacity(r), 0);
  if (total < DROP_WORTHWHILE_FLOOR) return [];
  return resources.map(r => requestOutput(target, r, target.store.getUsedCapacity(r)));
}

/**
 * Every dropped pile, tombstone, and ruin in `room` worth a purpose-built trip (DROP_WORTHWHILE_FLOOR,
 * checked against the TILE'S TOTAL across all resources — see groundRequestsFor's own doc), of ANY
 * resource type — mirrors graph.ts's providers() ground-pickup entries in spirit (tombstone/ruin gated the
 * same floor, urgency-1-equivalent since these decay; the rate-ranking system prices that urgency itself
 * via amount/distance rather than a separate flag), extended beyond energy-only so a dead boosted fighter's
 * spilled compounds (or any other valuable resource dropped/entombed/ruined) are no longer invisible to
 * Transport's pool.
 */
export function registerGroundResources(room: Room): LogisticsRequest[] {
  const out: LogisticsRequest[] = [];

  const drops = room.find(FIND_DROPPED_RESOURCES);
  for (const d of drops) out.push(...groundRequestsFor(d));

  const tombstones = room.find(FIND_TOMBSTONES);
  for (const t of tombstones) out.push(...groundRequestsFor(t));

  const ruins = room.find(FIND_RUINS);
  for (const r of ruins) out.push(...groundRequestsFor(r));

  return out;
}

/**
 * A remote room's container energy as an ordinary withdraw request, PLUS every dropped pile/tombstone/
 * ruin of any resource type (same tile-total gate as registerGroundResources — see that function's own
 * doc) — no room-boundary special case, no travelHome-style guard (ADR 0008's "drop travelHome's hard
 * reservation-span guard" decision: the targetedBy predicted-amount discount, applied by the caller's
 * ranking pass, is what keeps a remote pickup from over-committing a home consumer, not a refusal to
 * register at all). The container itself stays energy-only (it's the remote miner's own container, not a
 * decay-prone pickup) — only the ground pickups need the any-resource treatment, since those are what a
 * dead invader/defender's spilled boosts would show up as. `rooms` is every remote room this colony
 * currently has vision into with a selected/mined source — the caller (transportTaskRunner.ts) supplies
 * live Room objects for whichever remote rooms it can currently see, mirroring register.ts's own "read
 * Game.* directly" idiom.
 */
export function registerRemoteGroundResources(rooms: readonly Room[]): LogisticsRequest[] {
  const out: LogisticsRequest[] = [];
  for (const room of rooms) {
    const containers = room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_CONTAINER }) as StructureContainer[];
    for (const c of containers) {
      const stored = c.store.getUsedCapacity(RESOURCE_ENERGY);
      if (stored < DROP_WORTHWHILE_FLOOR) continue;
      out.push(requestOutput(c, RESOURCE_ENERGY, stored));
    }

    const drops = room.find(FIND_DROPPED_RESOURCES);
    for (const d of drops) out.push(...groundRequestsFor(d));

    const tombstones = room.find(FIND_TOMBSTONES);
    for (const t of tombstones) out.push(...groundRequestsFor(t));

    const ruins = room.find(FIND_RUINS);
    for (const r of ruins) out.push(...groundRequestsFor(r));
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
