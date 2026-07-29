// The provider/consumer graph: pure functions over ColonySnapshot -> data, the reusable abstraction
// legacy's RoomLogisticsOperation gestured at (LogisticTask{from,to,amount,type}) but never wired up.
// Reuses targets.ts's belowFillTo/isWorthwhile-shaped math so "is this container full/worth a trip" is
// asked once, not reinvented here — same reasoning, snapshot-pure instead of live-object.

import type { XY } from "../lib/geometry";
import type { ColonySnapshot, SnapContainer, SnapCreep, SnapDrop, SnapTombstone, SnapTower } from "../snapshot/types";
import type { NodeRef } from "./types";

export interface Provider {
  ref: NodeRef;
  resource: ResourceConstant;
  available: number; // energy sitting there right now
  urgency: number; // decay risk / overflow risk — dropped piles and near-full containers rank high
  // Where to range-check a creep against, for allocate.ts's nearest-that-can-fill pickup selection.
  // Null for a remote provider (cross-room; not comparable to a home creep's x/y in the same metric).
  pos: XY | null;
}

export interface Consumer {
  ref: NodeRef;
  resource: ResourceConstant;
  wanted: number; // free capacity, capped by fillTo-equivalent floors
  priority: number; // spawn/extension > tower > controller-container-floor
}

// Deliberately NOT hauler.ts's step order: hauler ranks controller-container above tower, which is
// faulty — an empty tower during an attack is worse than the controller container missing its 0.7
// floor. Logistics ranks tower above controller-container instead; this graph is the new, additive
// consumer of the spawn/extension-first knowledge only, not a full copy of hauler.ts's tier order.
const PRIORITY = {
  spawnSystem: 100,
  tower: 90,
  controllerContainer: 80,
  // New sinks so builder/upgrader aren't left to self-harvest once transport claims every ground
  // pile before they can scavenge it (the regression this fixes: construction/upgrading throughput
  // collapsed to whatever a creep could personally harvest, once maxHaulers:0 meant transport was
  // efficient enough to leave drops=0/containers=0 permanently). Builder ranks above upgrader per
  // explicit direction — a stalled build blocks the room's economy longer than slower upgrading does.
  builder: 40,
  upgrader: 30,
  // Storage is the overflow buffer: the lowest-priority sink, taken only when every live consumer
  // above is satisfied. It is the inverse of the source-side gate below — storage is a sink exactly
  // when the spawn system has no deficit, and a source exactly when it does, so it is never both in
  // the same tick and can never feed itself in a loop.
  storage: 20
} as const;

// The controller container is topped to a floor (not filled to 100%) so upgraders draining it for
// every last unit don't fight a transport creep forever — same floor hauler.ts already uses.
const CONTROLLER_CONTAINER_FILL_FLOOR = 0.7;

// A dropped pile below this floor isn't worth a purpose-built trip — same bar targets.ts's
// isWorthwhile applies per-creep, translated to an absolute colony-level floor since a Provider has no
// creep to size "worthwhile" against.
const DROP_WORTHWHILE_FLOOR = 50;

const CONTROLLER_CONTAINER_RANGE = 2; // range of the controller a controller container sits within

// Only upgraders parked at the controller are worth a transport trip. An upgrader wandering off to
// harvest or in transit isn't upgrading, so topping it up wherever it happens to be just drags a
// transport away from the bunker after a moving target — the same babysitting the completion fix
// avoids, applied at the consumer-selection level. Chebyshev range, matching isNearController's metric.
const UPGRADER_CONTROLLER_RANGE = 5;

function isNearController(colony: ColonySnapshot, c: SnapContainer): boolean {
  const dx = c.x - colony.controller.x;
  const dy = c.y - colony.controller.y;
  return Math.max(Math.abs(dx), Math.abs(dy)) <= CONTROLLER_CONTAINER_RANGE;
}

// Spawn/extension energy the room still wants this tick. The one switch that decides storage's role:
// a deficit means storage drains to cover it (source, supply's old job); no deficit means storage is
// the overflow sink. The two are mutually exclusive, which keeps storage from ever feeding itself.
function spawnSystemDeficit(colony: ColonySnapshot): number {
  return Math.max(0, colony.energyCapacity - colony.energyAvailable);
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
      urgency: c.storeCapacity > 0 ? c.storeEnergy / c.storeCapacity : 0,
      pos: { x: c.x, y: c.y }
    });
  }

  for (const d of colony.drops) {
    if (!isWorthwhileDrop(d)) continue;
    out.push({
      ref: { kind: "dropped", id: d.id },
      resource: RESOURCE_ENERGY,
      available: d.amount,
      urgency: 1, // ground energy decays — always treated as urgent once past the worthwhile floor
      pos: { x: d.x, y: d.y }
    });
  }

  // A dead creep's leftover energy — same worthwhile bar as a dropped pile, and it decays too
  // (tombstones expire), so it gets the same urgency treatment.
  for (const t of colony.tombstones) {
    if (t.storeEnergy < DROP_WORTHWHILE_FLOOR) continue;
    out.push({
      ref: { kind: "tombstone", id: t.id },
      resource: RESOURCE_ENERGY,
      available: t.storeEnergy,
      urgency: 1,
      pos: { x: t.x, y: t.y }
    });
  }

  // Remote energy waiting in remote rooms — the return-haul. Additive: these are *extra* providers on
  // top of the home ones above, so the local transport economy is untouched. A ground pile/tombstone
  // decays (urgency 1); a remote container doesn't. Same worthwhile floor as a home drop, since a tiny
  // remote pile isn't worth a cross-room trip either.
  //
  // NOT gated on the home spawn system's deficit: a hungry home spawn doesn't stop a transport creep
  // from being offered a remote pile too — allocate.ts's nearest-fill still prefers home providers
  // whenever one alone can cover the trip (remote entries carry pos: null, so nearest-fill skips them
  // entirely), so this only ever adds remote as a same-tick option, never displaces a closer home pickup.
  for (const r of colony.remoteEnergy) {
    if (r.amount < DROP_WORTHWHILE_FLOOR) continue;
    const ref: NodeRef =
      r.kind === "container"
        ? { kind: "structure", id: r.id as Id<AnyStoreStructure> }
        : r.kind === "tombstone"
          ? { kind: "tombstone", id: r.id as Id<Tombstone> }
          : { kind: "dropped", id: r.id as Id<Resource> };
    // Cross-room: no position comparable to a home creep's x/y, so nearest-fill selection (allocate.ts)
    // skips these and only the largest-first fallback ever picks them.
    out.push({ ref, resource: RESOURCE_ENERGY, available: r.amount, urgency: r.kind === "container" ? 0.5 : 1, pos: null });
  }

  // Storage as a source, but only while the spawn system is short: this is the drain direction the
  // supply role used to own — buffer out to keep spawning alive. When the spawn system is full,
  // storage is a sink instead (see consumers), never both. Lowest urgency: stored energy doesn't decay.
  if (colony.storageId && colony.storageEnergy > 0 && spawnSystemDeficit(colony) > 0) {
    const storageStruct = colony.structures.find(s => s.type === "storage");
    out.push({
      ref: { kind: "structure", id: colony.storageId as Id<AnyStoreStructure> },
      resource: RESOURCE_ENERGY,
      available: colony.storageEnergy,
      urgency: 0,
      pos: storageStruct ? { x: storageStruct.x, y: storageStruct.y } : null
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

  // One consumer per spawn/extension with free capacity, all at the spawn-system priority. Emitting
  // them individually (rather than a single "spawnSystem" aggregate) lets the allocator reserve each
  // extension for one creep's multi-dropoff trip — a full creep claims N extensions up front, removing
  // them from every other creep's options, instead of one being sent per extension per tick. The
  // aggregate energyAvailable/energyCapacity still drives fleet sizing and spawn gating elsewhere.
  for (const sink of colony.spawnSinks) {
    const wanted = sink.storeCapacity - sink.storeEnergy;
    if (wanted <= 0) continue;
    out.push({
      ref: { kind: "structure", id: sink.id as Id<AnyStoreStructure> },
      resource: RESOURCE_ENERGY,
      wanted,
      priority: PRIORITY.spawnSystem
    });
  }

  // Ranked above the controller container: an empty tower during an attack outranks the
  // controller container's 0.7 floor top-off.
  for (const t of colony.towers) {
    const wanted = t.storeCapacity - t.storeEnergy;
    if (wanted <= 0) continue;
    out.push({
      ref: { kind: "structure", id: t.id as unknown as Id<AnyStoreStructure> },
      resource: RESOURCE_ENERGY,
      wanted,
      priority: PRIORITY.tower
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

  // Lowest tiers: builder and upgrader as direct creep sinks, so they don't fall back to self-harvest
  // once transport has already claimed every ground pile — builder ranked above upgrader.
  for (const c of colony.creeps) {
    if (c.role !== "builder") continue;
    pushCreepConsumer(out, c, PRIORITY.builder);
  }
  for (const c of colony.creeps) {
    if (c.role !== "upgrader") continue;
    if (!isNearControllerPos(colony, c)) continue; // only upgraders at the controller are viable sinks
    pushCreepConsumer(out, c, PRIORITY.upgrader);
  }

  // Storage as the overflow buffer, lowest priority of all: taken only once every live consumer above
  // is satisfied. Gated on the spawn system being full — the exact inverse of the source-side gate, so
  // storage is a sink or a source but never both in the same tick (it can't feed itself). When spawn is
  // short, storage is a source (see providers) and skipped here.
  if (colony.storageId && spawnSystemDeficit(colony) === 0) {
    const wanted = colony.storageCapacity - colony.storageEnergy;
    if (wanted > 0) {
      out.push({
        ref: { kind: "structure", id: colony.storageId as Id<AnyStoreStructure> },
        resource: RESOURCE_ENERGY,
        wanted,
        priority: PRIORITY.storage
      });
    }
  }

  return out;
}

function isNearControllerPos(colony: ColonySnapshot, c: SnapCreep): boolean {
  const dx = c.x - colony.controller.x;
  const dy = c.y - colony.controller.y;
  return Math.max(Math.abs(dx), Math.abs(dy)) <= UPGRADER_CONTROLLER_RANGE;
}

function pushCreepConsumer(out: Consumer[], c: SnapCreep, priority: number): void {
  const wanted = c.storeCapacity - c.storeEnergy;
  if (wanted <= 0) return;
  out.push({ ref: { kind: "creep", id: c.id }, resource: RESOURCE_ENERGY, wanted, priority });
}
