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
//   - controller container top-up to its fill floor (registerControllerContainerRequest), the bunker's
//     own container near the storage tile top-up to the same floor (registerBunkerContainerRequest —
//     gh #61 follow-up: a Supply battery pre-storage, sitting on the road tile the goal layout claims
//     next to storage, see Base_2-rcl8.json), builder/upgrader battery requests pre-storage only
//     (registerCreepBatteryRequests), storage as the overflow sink for energy AND mineral once it exists
//     (registerStorageSinkRequests).
//   - Deliberately NOT included: storage's drain-for-spawn-need direction (graph.ts's storageBuffer
//     entry) — that's Supply's job, never Transport's (see graph.ts's own transportProviders() doc).
//     Spawn/extension/tower are never registered here at all — Supply's pool owns them exclusively.

import { requestInput, requestOutput, type LogisticsRequest } from "./request";
import { registerMineralContainerOutput, registerMinerContainerOutput } from "./register";
import GOAL_JSON from "../construction/Base_2.json";
import type { GoalLayout } from "../construction/sync";

const GOAL = GOAL_JSON as GoalLayout;

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

// The bunker container's tile is a fixed offset from the anchor (see Base_2-rcl8.json: the road
// intersection next to storage, added so a pre-storage colony has a Supply pickup point sitting where
// storage will eventually go) — same "known before storage is built" shape upgrading.ts's own
// storageTile() uses for the controller container's road target, duplicated here rather than imported
// since that helper is private to upgrading.ts and this module's whole convention is reading Game.*/
// Memory directly rather than pulling in another operation's internals.
const BUNKER_CONTAINER_OFFSET = GOAL.placements.find(p => p.type === "container");

/**
 * The bunker's own container (near the storage tile, see BUNKER_CONTAINER_OFFSET's doc) topped to the
 * same fill floor as the controller container (CONTROLLER_CONTAINER_FILL_FLOOR) — a battery for Supply
 * to draw spawn/extension/tower energy from without walking to storage, mirroring
 * registerControllerContainerRequest exactly except keyed on the anchor-relative goal tile instead of
 * the controller's live position (this container exists before storage does, so it can't be found by
 * proximity to storage itself). `anchor` is ColonyMemory.anchor (owned by building, read directly since
 * this module never takes a ColonySnapshot) — undefined until Building has resolved one, same as any
 * other anchor-relative lookup this early in a colony's life.
 */
export function registerBunkerContainerRequest(room: Room, anchor: { x: number; y: number } | undefined): LogisticsRequest | undefined {
  if (!anchor || !BUNKER_CONTAINER_OFFSET) return undefined;
  const x = anchor.x + BUNKER_CONTAINER_OFFSET.x;
  const y = anchor.y + BUNKER_CONTAINER_OFFSET.y;
  const container = room
    .lookForAt(LOOK_STRUCTURES, x, y)
    .find((s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER);
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

/** One boost lab's persisted claim — Colony.labs()'s own output (ColonyMemory.boostClaims' value shape),
 * named here so registerBoostLabWantRequest/buildTransportPool don't need to import the whole
 * ColonyMemory interface for one nested type. */
export interface BoostLabClaim {
  compound: ResourceConstant;
  amount: number;
}

/**
 * One boost lab's want-request (gh #61 epic, docs/boosting-lab-runner-design.md section 4's "claims are
 * data; the logistics system generates its own request from them" — moved here from stewardRegister.ts's
 * pool after live integration testing found Steward's fixed single-anchor-tile design can never reach a
 * boost lab elsewhere in the bunker layout, see registerStewardRequests's own doc for the confirmed
 * failure mode): if this lab currently holds a persisted claim (Colony.labs()'s output,
 * ColonyMemory.boostClaims), it wants `claim.amount` of `claim.compound` delivered — same "want" shape as
 * every other pickup/deliver request in Transport's pool, so it competes fairly in the SAME rate-ranked
 * pool rather than needing its own bespoke delivery mechanism. Transport creeps roam the whole room freely
 * (no fixed-position constraint), so a lab anywhere in the bunker is reachable exactly like any other
 * consumer here.
 *
 * Mirrors stewardRegister.ts's registerMineralStorageWantRequest's own double-cap exactly: the shortfall
 * (`claim.amount - used`) is capped by the lab's own `getFreeCapacity(claim.compound)` — never larger than
 * what the lab can actually receive right now. This cap does double duty for the single-mineral-type case
 * (a lab currently committed to a DIFFERENT compound than `claim.compound`, leftover from an earlier,
 * now-reconciled claim): per the real engine's store semantics, `getFreeCapacity` for any OTHER compound
 * reports 0/null until the lab is actually emptied of the old compound, with no special-casing needed here.
 */
// Every boost-related request in Transport's pool (a lab's compound want, its energy want, and the
// matching storage/terminal compound source) needs to reliably outscore Transport's OWN routine traffic —
// pickBestPair's selection is pure amount*multiplier/distance, and at the default multiplier (1, what
// every request in this codebase used before gh #61 — confirmed by inspection) a boost delivery's amount
// is often tiny next to a mature economy's routine legs (storage's energy sink alone can run into the
// hundreds of thousands of free capacity; a long-running colony's established container/ground-pickup
// traffic keeps every idle Transport creep busy). Confirmed live via integration testing, TWICE, in two
// different shapes of the same underlying bug:
//   1. A claimed lab's energy want (LAB_ENERGY_CAPACITY=2000) sat at 0 for 400+ ticks against storage's
//      much larger routine energy want, in an otherwise-idle freshly-seeded colony.
//   2. A claimed lab's COMPOUND want, seeded fresh into an idle colony from tick 0, delivered within ~20
//      ticks with the default multiplier and looked completely fine — until the exact same compound
//      arrived into an ALREADY-RUNNING, mature colony's economy (the cross-colony empire-transfer
//      scenario) over a thousand ticks in, where it then sat undelivered for 1000+ ticks: the timing of
//      *when* a boost need appears determines whether the default multiplier happens to win, which means
//      it was never reliable, just accidentally fast in the single-colony test's idle-from-tick-0 case.
// An actively-needed boost is categorically more urgent than routine accumulation/hauling, so every boost
// request gets the same large multiplier — large enough to win even against a fully-drained
// 1,000,000-capacity storage's worst case for energy (~1,000,000 / LAB_ENERGY_CAPACITY ≈ 500) with real
// headroom, and equally applied to the compound side so its priority can't regress the same way once a
// colony's economy is mature rather than freshly seeded.
const BOOST_URGENCY_MULTIPLIER = 1000;

export function registerBoostLabWantRequest(lab: StructureLab | undefined, claim: BoostLabClaim | undefined): LogisticsRequest | undefined {
  if (!lab || !claim) return undefined;
  const used = lab.store.getUsedCapacity(claim.compound) ?? 0;
  const free = lab.store.getFreeCapacity(claim.compound) ?? 0;
  const towardClaim = Math.min(claim.amount - used, free);
  if (towardClaim <= 0) return undefined;
  return requestInput(lab, claim.compound, towardClaim, 0, BOOST_URGENCY_MULTIPLIER);
}

/**
 * A boost lab's own energy want (gh #61 epic) — `StructureLab.boostCreep()` consumes BOTH
 * LAB_BOOST_MINERAL (30/part, registerBoostLabWantRequest's own concern) AND LAB_BOOST_ENERGY (20/part)
 * per the real engine (@screeps/engine's processor/intents/labs/boost-creep.js: `object.store.energy <
 * C.LAB_BOOST_ENERGY` fails the whole call) — confirmed live via integration testing: a lab correctly
 * stocked with its claimed compound still made boostCreep() fail with ERR_NOT_ENOUGH_RESOURCES every tick,
 * since nothing anywhere in this pipeline had ever requested energy for it. Tops a lab up toward its own
 * energy capacity rather than sizing precisely to any claim's exact per-part need — energy is cheap/
 * abundant compared to a boost compound, and a topped-up lab stays ready for whichever creep queues up
 * next rather than being re-emptied to near-zero after every single boost.
 *
 * Deliberately NOT gated on an active claim (unlike registerBoostLabWantRequest's own compound want,
 * which only makes sense for whatever's actually claimed) — every one of a colony's reserved boost labs
 * always wants energy toward full, all the time. Confirmed live: gating this on `claim` the same way the
 * compound want is gated meant a lab's energy only ever started filling AFTER a claim appeared, adding a
 * full top-up's worth of avoidable latency (~80-100 ticks observed) on top of every boost order, even
 * though the compound itself could already be sitting in the lab from an earlier delivery. Energy is
 * cheap and lab capacity is small (LAB_ENERGY_CAPACITY) — pre-staging it costs nothing and means a fresh
 * claim only ever has to wait on the compound, never on energy too. See BOOST_URGENCY_MULTIPLIER's own
 * doc for why this needs a deliberately high multiplier, not the default.
 */
export function registerBoostLabEnergyWantRequest(lab: StructureLab | undefined): LogisticsRequest | undefined {
  if (!lab) return undefined;
  const wanted = lab.store.getFreeCapacity(RESOURCE_ENERGY);
  if (!wanted || wanted <= 0) return undefined;
  return requestInput(lab, RESOURCE_ENERGY, wanted, 0, BOOST_URGENCY_MULTIPLIER);
}

/**
 * Storage's/terminal's own resting stock of a compound with an ACTIVE boost claim right now, offered as
 * Transport's withdraw source for that compound — the paired half registerBoostLabWantRequest's own want
 * needs to ever actually match (greedyMatch.ts's pickBestPair requires a real opposite-signed candidate to
 * exist before pairing at all; a one-sided want, however large, is never scored — see that module's own
 * header). Deliberately NOT the same as registerStorageSinkRequests (that's the INPUT/sink half, and only
 * for energy/the room's own mined mineral) or stewardRegister.ts's registerMineralStorageSurplusRequest
 * (that's gated on being above BOOST_TARGETS' empire target, LIQUIDATION_MODE-sensitive, and Steward-only —
 * exactly the mechanism that made compound-at-target unreachable for a lab in earlier testing). This
 * function has no target/threshold at all: it offers whatever's actually sitting in storage/terminal for a
 * compound something is CLAIMING right now, full stop — scoped to active claims only (not "storage's ENTIRE
 * mineral stock is always biddable"), so it can't turn into a constant, pointless self-pairing race against
 * registerStorageSinkRequests's own want for the same resource on every other tick.
 *
 * Uses BOOST_URGENCY_MULTIPLIER on the OUTPUT side too, not just the lab's own want: greedyMatch.ts's
 * pickBestPair scores the OVERALL cross-resource race by the OUTPUT side's `multiplier * amount /
 * distance` (see that module's own doc), so this is what actually decides whether an idle Transport creep
 * picks up a boost delivery at all versus one of the colony's routine energy/ground-pickup tasks — see
 * BOOST_URGENCY_MULTIPLIER's own doc for the confirmed live failure this fixes (a compound arriving into
 * an already-mature economy sat undelivered for 1000+ ticks at the default multiplier, even though the
 * exact same delivery mechanism worked in under 20 ticks against a freshly-seeded, still-idle colony).
 *
 * `shortfalls` carries each claim's REMAINING need (registerBoostLabWantRequest's own `labWant.amount`,
 * already `claim.amount` minus whatever the lab currently holds), not the claim's raw face-value amount —
 * offering the compound's full stored stock as this leg's output (the original shape) let a Transport
 * creep's uncapped withdraw+deliver carry away far more than any order actually needed (confirmed live: a
 * 390-unit order ended up with 1150 units sitting in the lab, permanently stranded — nothing ever
 * requests a lab drain its own OVER-stock back out). Capping the registered amount here to the real
 * summed shortfall keeps the SCORING honest; the actual withdraw is separately capped to the precise
 * amount via Task.amount (transportTaskRunner.ts's planTransportTask) — this is what keeps `stored` from
 * ever being read as "you may take all of this."
 */
export function registerBoostCompoundSourceRequests(
  storage: StructureStorage | undefined,
  terminal: StructureTerminal | undefined,
  shortfalls: Iterable<BoostLabClaim>
): LogisticsRequest[] {
  const out: LogisticsRequest[] = [];
  const neededByCompound = new Map<ResourceConstant, number>();
  for (const s of shortfalls) neededByCompound.set(s.compound, (neededByCompound.get(s.compound) ?? 0) + s.amount);

  for (const [compound, needed] of neededByCompound) {
    if (needed <= 0) continue;
    if (storage) {
      const amount = Math.min(storage.store.getUsedCapacity(compound), needed);
      if (amount > 0) out.push(requestOutput(storage, compound, amount, 0, BOOST_URGENCY_MULTIPLIER));
    }
    if (terminal) {
      const amount = Math.min(terminal.store.getUsedCapacity(compound), needed);
      if (amount > 0) out.push(requestOutput(terminal, compound, amount, 0, BOOST_URGENCY_MULTIPLIER));
    }
  }
  return out;
}
