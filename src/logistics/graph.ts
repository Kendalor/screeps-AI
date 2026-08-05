// The provider/consumer graph: pure functions over ColonySnapshot -> data, the reusable abstraction
// legacy's RoomLogisticsOperation gestured at (LogisticTask{from,to,amount,type}) but never wired up.
// Reuses targets.ts's belowFillTo/isWorthwhile-shaped math so "is this container full/worth a trip" is
// asked once, not reinvented here — same reasoning, snapshot-pure instead of live-object.

import type { XY } from "../lib/geometry";
import type { ColonySnapshot, SnapContainer, SnapCreep, SnapDrop, SnapRuin, SnapTombstone, SnapTower } from "../snapshot/types";
import type { NodeRef } from "./types";

export interface Provider {
  ref: NodeRef;
  resource: ResourceConstant;
  available: number; // energy sitting there right now
  urgency: number; // decay risk / overflow risk — dropped piles and near-full containers rank high
  // Where to range-check a creep against, for allocate.ts's nearest-that-can-fill pickup selection.
  // Null for a remote provider (cross-room; not comparable to a home creep's x/y in the same metric).
  pos: XY | null;
  // Cross-room source: allocate.ts must not chain a deliver onto a pickup chain that draws from one of
  // these — the creep needs a travelHome leg first so the consumer isn't reserved for the whole
  // cross-room trip home. Absent (falsy) for every home provider.
  remote?: boolean;
  // Cached home anchor -> remote source route length (SnapRemoteSource.distance), the real-path
  // distance mining/distance.ts or remotePath.ts already computed once for this source. Present only
  // when `remote` is true — allocate.ts's nearest-fill picker uses it in place of a live path search
  // (which `pos: null` rules out for a cross-room target), so a remote pile can now win a nearest-fill
  // decision instead of only ever being reached via the largest-first fallback.
  remoteDistance?: number;
  // Storage's own drain-for-spawn-need entry (see providers(), below): supply's job, never transport's.
  // Storage sits at/near the bunker anchor and usually holds the most energy, so with no priority field
  // on Provider at all (unlike Consumer), it would otherwise win pickNearestFillingProvider/
  // pickLargestProvider outright — round-tripping transport creeps into a pointless storage->storage
  // loop once storage is also open as a consumer (its overflow-sink entry, gated separately). transport's
  // own view filters this flag out entirely; supplyProviders keeps it, since draining storage to cover a
  // spawn deficit is exactly supply's reason to exist.
  storageBuffer?: boolean;
}

export interface Consumer {
  ref: NodeRef;
  resource: ResourceConstant;
  wanted: number; // free capacity, capped by fillTo-equivalent floors
  priority: number; // spawn/extension > tower > controller-container-floor
  // Where to range-check a creep against, for allocate.ts's route-ordering of a same-priority deliver
  // chain (e.g. which extension to visit next). Null for a consumer with no fixed position (a creep
  // sink) — those fall back to array order, same as before this field existed.
  pos: XY | null;
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
  // Pre-storage only: consumers() below emits these two exclusively while colony.storageId is unset.
  builder: 40,
  upgrader: 30,
  // Storage is the sink once it exists: builder/upgrader (above) are the pre-storage fallback so a
  // creep isn't left to self-harvest before storage is built, but consumers() stops emitting them the
  // moment storage exists — transport should always feed storage rather than hand-feeding creeps
  // directly. Still below spawn/tower/controller-container. It is the inverse of the source-side gate
  // below — storage is a sink exactly when the spawn system has no deficit, and a source exactly when
  // it does, so it is never both in the same tick and can never feed itself in a loop.
  storage: 70
} as const;

// The controller container is topped to a floor (not filled to 100%) so upgraders draining it for
// every last unit don't fight a transport creep forever — same floor hauler.ts already uses.
const CONTROLLER_CONTAINER_FILL_FLOOR = 0.7;

// A dropped pile below this floor isn't worth a purpose-built trip — same bar targets.ts's
// isWorthwhile applies per-creep, translated to an absolute colony-level floor since a Provider has no
// creep to size "worthwhile" against.
const DROP_WORTHWHILE_FLOOR = 50;

const CONTROLLER_CONTAINER_RANGE = 1; // range of the controller a controller container sits within

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

  // A destroyed structure's leftover energy — same treatment as a tombstone, just a different source
  // (a ruin instead of a dead creep). Also decays, so it gets the same urgency.
  for (const r of colony.ruins) {
    if (r.storeEnergy < DROP_WORTHWHILE_FLOOR) continue;
    out.push({
      ref: { kind: "ruin", id: r.id },
      resource: RESOURCE_ENERGY,
      available: r.storeEnergy,
      urgency: 1,
      pos: { x: r.x, y: r.y }
    });
  }

  // Remote energy waiting in remote rooms — the return-haul. Additive: these are *extra* providers on
  // top of the home ones above, so the local transport economy is untouched. A ground pile/tombstone/ruin
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
          : r.kind === "ruin"
            ? { kind: "ruin", id: r.id as Id<Ruin> }
            : { kind: "dropped", id: r.id as Id<Resource> };
    // A container sits on one specific source's drop spot — match it by containerId for the exact
    // route length. A ground pile/tombstone/ruin isn't tied to one source, so fall back to any source
    // already selected in that room (remoteEnergyFor only ever scans a room pickRemotes chose, so one
    // is always present once remoteEnergy itself is non-empty for that room).
    const bySource = colony.remoteSources.find(s => s.room === r.room && s.containerId === r.id);
    const anyInRoom = colony.remoteSources.find(s => s.room === r.room);
    // Cross-room: no position comparable to a home creep's x/y, so nearest-fill selection (allocate.ts)
    // compares remoteDistance instead of pos for these.
    out.push({
      ref,
      resource: RESOURCE_ENERGY,
      available: r.amount,
      urgency: r.kind === "container" ? 0.5 : 1,
      pos: null,
      remote: true,
      remoteDistance: (bySource ?? anyInRoom)?.distance
    });
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
      pos: storageStruct ? { x: storageStruct.x, y: storageStruct.y } : null,
      storageBuffer: true
    });
  }

  return out;
}

function isWorthwhileDrop(d: SnapDrop): boolean {
  return d.amount >= DROP_WORTHWHILE_FLOOR;
}

// Supply's own view of providers(): storage (when it has a deficit to cover — same gate as above) or
// the nearest worthwhile local pile/container, but NEVER a remote-room source. Supply is a short-hop
// spawn-topper, not a hauler — sending it cross-room to a remote container/drop would strand the spawn
// system for the whole round trip a real hauler(transport) is already sized for. Filtering the shared
// list (rather than a separate scan) keeps this in lockstep with providers()'s own worthwhile floors.
export function supplyProviders(colony: ColonySnapshot): Provider[] {
  return providers(colony).filter(p => !p.remote);
}

// Transport's own view of providers(): everything EXCEPT storage's drain-for-spawn-need entry — that
// buffer-out direction is supply's job (see supplyProviders/storageBuffer's doc on Provider). Without
// this, storage — usually nearest to the bunker and holding the most energy, with no priority field on
// Provider to rank it below other sources — wins transport's own pickup selection outright, and once
// storage is also open as a consumer (its overflow-sink entry), that produces a pointless
// storage-to-storage round trip instead of transport ever touching the source container it should be
// draining.
export function transportProviders(colony: ColonySnapshot): Provider[] {
  return providers(colony).filter(p => !p.storageBuffer);
}

// Supply's own view of consumers(): spawn/extensions and towers only — never the controller container
// or a builder/upgrader/storage sink. Those are transport's job; Supply exists solely to keep the
// spawn system (and, since an empty tower is as bad as an empty spawn during an attack, towers) topped.
export function supplyConsumers(colony: ColonySnapshot): Consumer[] {
  return consumers(colony).filter(c => c.priority === PRIORITY.spawnSystem || c.priority === PRIORITY.tower);
}

/**
 * Spawn/extensions as one aggregate node, plus the controller container while below its fill floor.
 *
 * `skipSupplyTiers`: while a live supply creep exists, transport must leave spawnSystem/tower to it
 * entirely rather than only working around whatever supply's own allocate() pass reserved this tick —
 * supply is a short-hop topper that's typically idle/mid-trip on any given tick, so without this a
 * multi-extension room's uncovered remainder kept falling to transport, which then treated a routine
 * top-off as equal-or-higher priority than controller-container/storage and dragged transport off its
 * own longer-haul work every time supply couldn't reach every sink in one pass. Supply's own view
 * (supplyConsumers, below) is unaffected — it never looks at this flag.
 */
export function consumers(colony: ColonySnapshot, skipSupplyTiers = false): Consumer[] {
  const out: Consumer[] = [];

  if (!skipSupplyTiers) {
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
        priority: PRIORITY.spawnSystem,
        pos: { x: sink.x, y: sink.y }
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
        priority: PRIORITY.tower,
        pos: { x: t.x, y: t.y }
      });
    }
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
      priority: PRIORITY.controllerContainer,
      pos: { x: c.x, y: c.y }
    });
  }

  // Lowest tiers: builder and upgrader as direct creep sinks, so they don't fall back to self-harvest
  // once transport has already claimed every ground pile — builder ranked above upgrader. Only while
  // there's no storage yet: once storage exists, transport should always feed it instead of hand-
  // feeding creeps directly — storage is never further away than the creeps it would otherwise chase,
  // and a creep needing energy can draw from storage itself rather than waiting on a transport delivery.
  if (!colony.storageId) {
    for (const c of colony.creeps) {
      if (c.role !== "builder") continue;
      pushCreepConsumer(out, c, PRIORITY.builder);
    }
    for (const c of colony.creeps) {
      if (c.role !== "upgrader") continue;
      if (!isNearControllerPos(colony, c)) continue; // only upgraders at the controller are viable sinks
      pushCreepConsumer(out, c, PRIORITY.upgrader);
    }
  }

  // Storage as the overflow buffer, once it exists builder/upgrader are no longer emitted as
  // consumers at all (see the storageId gate above) — this is the sole sink transport falls to below
  // spawn/tower/controller-container. NOT gated on the spawn system being full: that gate used to block
  // storage as a consumer any tick energyAvailable dipped below energyCapacity by even 1 point — which is
  // most ticks in an actively-spawning colony — starving transport of anywhere to route a full source
  // container's energy (spawn/tower/controller-container all satisfied, storage the only remaining sink,
  // but disabled anyway). Storage-as-source (providers(), below) keeps its own deficit gate — the two
  // aren't mutually exclusive: a creep can legitimately drain storage for spawn need on one trip while
  // another delivers surplus container energy into it, and even a single creep picking up from and
  // delivering back to storage in the same chain is just a wasted round-trip, not a feedback loop (this
  // is a plan-once-per-tick allocator, not a re-entrant one).
  if (colony.storageId) {
    const wanted = colony.storageCapacity - colony.storageEnergy;
    if (wanted > 0) {
      const storageStruct = colony.structures.find(s => s.type === "storage");
      out.push({
        ref: { kind: "structure", id: colony.storageId as Id<AnyStoreStructure> },
        resource: RESOURCE_ENERGY,
        wanted,
        priority: PRIORITY.storage,
        pos: storageStruct ? { x: storageStruct.x, y: storageStruct.y } : null
      });
    }
  }

  return out;
}

export interface StorageOverflow {
  ref: NodeRef;
  free: number;
}

// Storage's raw free capacity right now, regardless of the spawnSystemDeficit gate consumers() applies
// above. Used only by allocate.ts as a last-resort dump for a creep that already carries energy (from a
// decaying pile, or a target that went stale) and found no live consumer for it this tick — never as a
// pickup source in that same leg, so it can't recreate the withdraw-then-redeposit loop the gate exists
// to prevent. Without this, a creep stuck in that spot sits on unrouted cargo (or worse, the speculative
// pass sends it to fetch yet MORE energy) any tick the spawn system has even a token deficit — which is
// most ticks in an actively-spawning colony, since the gate is all-or-nothing on the aggregate deficit.
export function storageOverflow(colony: ColonySnapshot): StorageOverflow | null {
  if (!colony.storageId) return null;
  const free = colony.storageCapacity - colony.storageEnergy;
  if (free <= 0) return null;
  return { ref: { kind: "structure", id: colony.storageId as Id<AnyStoreStructure> }, free };
}

function isNearControllerPos(colony: ColonySnapshot, c: SnapCreep): boolean {
  const dx = c.x - colony.controller.x;
  const dy = c.y - colony.controller.y;
  return Math.max(Math.abs(dx), Math.abs(dy)) <= UPGRADER_CONTROLLER_RANGE;
}

function pushCreepConsumer(out: Consumer[], c: SnapCreep, priority: number): void {
  const wanted = c.storeCapacity - c.storeEnergy;
  if (wanted <= 0) return;
  out.push({ ref: { kind: "creep", id: c.id }, resource: RESOURCE_ENERGY, wanted, priority, pos: { x: c.x, y: c.y } });
}
