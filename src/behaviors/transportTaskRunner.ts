// The live Transport role's cutover onto the new logistics system (gh #52, ADR 0008): for each idle
// Transport creep, builds the full rate-ranked pool (logistics/transportRegister.ts's registration
// functions), applies the targetedBy predicted-amount discount (logistics/targeted.ts, gh #49) and
// buffer-detour route evaluation (logistics/route.ts, gh #47), and assigns the resulting Task chain
// (logistics/task.ts, gh #45) to CreepMemory.logisticsTask — executed one tick at a time by
// logisticsTaskRunner.ts's runLogisticsTask, which this module simply delegates to once a task exists.
//
// Replaces graph.ts's transportProviders()/consumers() and allocate.ts's greedy nearest-fill matcher for
// the Transport role specifically (see operations/logistics.ts, whose intents() no longer plans transport
// creeps — Supply's old planning there is untouched). No ColonySnapshot indirection: registration reads
// Game.* directly, same as every other module under src/logistics/ (ADR 0008's scoped departure).

import { SOURCE_SATURATING_WORK } from "./roles/miner";
import { pickBestRoute, type Buffer } from "../logistics/route";
import type { LogisticsRequest } from "../logistics/request";
import { buildTargetedBy, discountedAmount, type TargetedBy } from "../logistics/targeted";
import { fork, persistTask, resolveTask, type Task } from "../logistics/task";
import {
  registerControllerContainerRequest,
  registerCreepBatteryRequests,
  registerGroundEnergy,
  registerMineralContainerOutput,
  registerMinerContainerOutput,
  registerRemoteEnergy,
  registerStorageSinkRequests
} from "../logistics/transportRegister";
import { runLogisticsTask } from "./logisticsTaskRunner";

// A miner's known harvest rate for registerMinerContainerOutput's dAmountdt — see that function's own
// doc: a fast source's container reads as more urgent sooner. SOURCE_SATURATING_WORK is the WORK-part
// COUNT a fully-staffed local source's miner carries; multiplied by the engine's own HARVEST_POWER this
// is the same energy/tick figure logistics/fleet.ts already prices miner income off, not a separate guess.
const LOCAL_MINER_HARVEST_RATE = SOURCE_SATURATING_WORK * HARVEST_POWER;

// Every remote room this colony currently has LIVE vision into, among the rooms it has selected for
// remote mining (ColonyMemory.remotes — the same list snapshot/colony.ts's own remote join reads).
// Reading Memory directly (not a ColonySnapshot) matches this module's whole self-registration idiom;
// `Game.rooms[name]` is undefined for any remote with no creep/observer providing vision that tick, which
// registerRemoteEnergy naturally treats as "nothing to register" by simply not being handed that room.
function remoteRoomsWithVision(home: string): Room[] {
  const remotes = Memory.colonies[home]?.remotes ?? [];
  const out: Room[] = [];
  for (const r of remotes) {
    const room = Game.rooms[r.room];
    if (room) out.push(room);
  }
  return out;
}

/**
 * Every live LogisticsRequest in Transport's pool for `home` right now — every provider/consumer
 * graph.ts's transportProviders()/consumers() covered that isn't Supply's (spawn/extension/tower) or
 * Steward's (anchor link/storage/terminal). See transportRegister.ts's header for the exact scope.
 */
export function buildTransportPool(home: Room): LogisticsRequest[] {
  const out: LogisticsRequest[] = [];

  for (const source of home.find(FIND_SOURCES)) {
    const request = registerMinerContainerOutput(source, LOCAL_MINER_HARVEST_RATE);
    if (request) out.push(request);
  }

  const mineral = home.find(FIND_MINERALS)[0];
  if (mineral) {
    const request = registerMineralContainerOutput(mineral);
    if (request) out.push(request);
  }

  out.push(...registerGroundEnergy(home));
  out.push(...registerRemoteEnergy(remoteRoomsWithVision(home.name)));

  const controller = home.controller;
  const controllerRequest = registerControllerContainerRequest(home, controller);
  if (controllerRequest) out.push(controllerRequest);

  const storage = home.storage;
  out.push(...registerCreepBatteryRequests(home.find(FIND_MY_CREEPS), controller, storage !== undefined));
  out.push(...registerStorageSinkRequests(storage, mineral?.mineralType));

  return out;
}

// Every distinct resource this tick's pool has demand for, in no particular order — planTransportTask's
// empty-creep branch races every resource's best withdraw+deliver pair against every other's (see its own
// doc), so nothing downstream depends on this list's ordering; it exists purely to avoid re-scanning the
// pool once per possible ResourceConstant.
function resourcesInPool(pool: readonly LogisticsRequest[]): ResourceConstant[] {
  const seen = new Set<ResourceConstant>();
  const out: ResourceConstant[] = [];
  for (const r of pool) {
    if (seen.has(r.resource)) continue;
    seen.add(r.resource);
    out.push(r.resource);
  }
  return out;
}

// A creep already carrying resource: which one, out of what's actually in its store — mirrors
// allocate.ts's creepResource (a mineralMiner/transport never carries both at once).
function carriedResource(creep: Creep, candidates: readonly ResourceConstant[]): ResourceConstant | undefined {
  for (const resource of candidates) {
    if (creep.store.getUsedCapacity(resource) > 0) return resource;
  }
  return undefined;
}

const NO_BUFFERS: Buffer[] = []; // storage IS a registered consumer already; no separate buffer-detour stop is added on top of it here for the withdraw side (see planTransportTask's own doc).

/**
 * Picks the best-scoring request for `resource` among `pool` entries whose sign matches `direction`
 * ("output" = amount < 0, a target HAS resource to give; "input" = amount > 0, a target WANTS resource
 * delivered) — the withdraw-vs-deliver-scoped sibling of targeted.ts's pickBestDiscountedRequest, which
 * ranks BOTH signs together. Splitting by sign is required here: pickBestDiscountedRequest alone would
 * let a large deliver-side want (e.g. storage's 1,000,000-capacity mineral want) always outscore and mask
 * a small withdraw-side have (e.g. a container holding 1,500 mineral) for the SAME resource, so an idle
 * creep would never even see the withdraw candidate to pick it up in the first place — confirmed live
 * during gh #52's own integration testing: a mineral withdraw request was silently starved out of every
 * ranking pass by storage's own much larger mineral-want request scoring higher for the identical
 * resource. `exclude` mirrors pickBestDiscountedRequest's own param (the creep doing the ranking, so it
 * isn't discounted by its own already-claimed target).
 */
function pickBestInDirection(
  pool: readonly LogisticsRequest[],
  resource: ResourceConstant,
  direction: "input" | "output",
  from: RoomPosition,
  targetedBy: TargetedBy,
  exclude?: Creep
): LogisticsRequest | undefined {
  let best: LogisticsRequest | undefined;
  let bestScore = -Infinity;
  for (const request of pool) {
    if (request.resource !== resource) continue;
    if (direction === "output" ? request.amount >= 0 : request.amount <= 0) continue;
    const distance = from.getRangeTo(request.target.pos);
    const amount = discountedAmount(request, targetedBy, exclude);
    if (amount <= 0) continue;
    const score = (request.multiplier * amount) / Math.max(1, distance);
    if (score > bestScore) {
      best = request;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Plans a fresh Task chain for an idle Transport creep: builds the pool (buildTransportPool), discounts
 * it by every OTHER Transport creep's already-persisted task (targeted.ts's discountedAmount, gh #49),
 * and — for whichever resource the creep ends up carrying/picking — either evaluates a buffer-detour
 * route (route.ts's pickBestRoute, gh #47) for a delivery request, or a withdraw leg CHAINED to the
 * pool's own best deliver target for a withdraw request (see pickBestInDirection's own doc for why
 * withdraw/deliver candidates must be ranked separately per resource, not together). Transport's pool has
 * no fixed, always-present sink the way Steward's does (storage) or the old graph.ts's did (spawnSystem —
 * deliberately excluded here, Supply's alone): a withdraw-side request (a container/pile with resource to
 * give) is only worth picking up if the SAME pool also has somewhere that resource is actually wanted —
 * otherwise a creep would carry it around forever with nowhere to put it (confirmed live: this was a real
 * bug during development, a bare withdraw task with no `.parent` left transport creeps permanently loaded
 * and idle the instant no controller-container/battery/storage consumer existed yet, e.g. RCL1-2 before
 * storage). `otherTransportCreeps` is every OTHER live Transport creep (excluding this one), scanned fresh
 * by the caller once per tick's planning pass — the same "derive targetedBy fresh, never cache" rule
 * targeted.ts's header documents.
 *
 * The empty-creep case races EVERY resource's best withdraw+deliver pair against every other's on the
 * withdraw leg's own discounted rate, and takes the single best pair overall — a genuine cross-resource
 * race, not "try energy first, fall back to mineral only if energy has nothing workable." This is the
 * actual mechanism the PRD/ADR 0008 call for (a long-starved mineral pickup outranking a routine energy
 * hop) and matches Overmind's own `transporterPreferences()` (`LogisticsNetwork.ts`), which sorts its
 * entire mixed-resource `requests` array by rate with no resource-type pre-filter — verified directly
 * against bencbartlett/Overmind's source, not just this repo's own paraphrase of it. An earlier version of
 * this function walked `resources` in a fixed energy-first order and returned the FIRST resource with a
 * workable pair, which meant mineral was never even scored while any energy withdraw+deliver pair existed
 * — since energy is (per the PRD's own opening line) almost never simultaneously absent everywhere, this
 * made the PRD's headline behavior structurally unreachable in the live Transport role. Found and fixed
 * after live pserver observation prompted re-deriving this loop from first principles.
 */
export function planTransportTask(creep: Creep, home: Room, otherTransportCreeps: readonly Creep[]): Task | undefined {
  const pool = buildTransportPool(home);
  if (pool.length === 0) return undefined;

  const resources = resourcesInPool(pool);
  const targetedBy = buildTargetedBy(otherTransportCreeps);

  // A creep already carrying load: only its own resource is a candidate (mirrors allocate.ts's
  // byLoadedFirst — a mineral-carrying creep never gets offered an energy deliver, and vice versa).
  const carrying = carriedResource(creep, resources);

  if (carrying) {
    // Loaded: only a deliver (input) request for the carried resource is actionable — Transport's pool
    // has no buffer detour to pick up more first (NO_BUFFERS below), so evaluate a direct route only.
    const best = pickBestInDirection(pool, carrying, "input", creep.pos, targetedBy, creep);
    if (!best) return undefined;
    const carryingAmount = creep.store.getUsedCapacity(carrying);
    const capacity = carryingAmount + creep.store.getFreeCapacity(carrying);
    const picked = pickBestRoute(best, creep.pos, NO_BUFFERS, carryingAmount, capacity, (a, b) => a.getRangeTo(b));
    return picked?.task;
  }

  // Empty: score every resource's best complete (withdraw+deliver) pair on the withdraw leg's own
  // discounted rate, and take the single best pair across ALL resources — see this function's own doc.
  // A resource with a withdraw candidate but nowhere to deliver it is skipped entirely (never scored),
  // matching the "never carry it around forever" rule above.
  let bestPair: { withdraw: LogisticsRequest; deliverTarget: LogisticsRequest["target"]; resource: ResourceConstant; score: number } | undefined;
  for (const resource of resources) {
    const bestOutput = pickBestInDirection(pool, resource, "output", creep.pos, targetedBy, creep);
    if (!bestOutput) continue;
    const deliverTarget = pickBestInDirection(pool, resource, "input", bestOutput.target.pos, targetedBy, creep);
    if (!deliverTarget) continue;

    const distance = creep.pos.getRangeTo(bestOutput.target.pos);
    const amount = discountedAmount(bestOutput, targetedBy, creep);
    const score = (bestOutput.multiplier * amount) / Math.max(1, distance);

    if (!bestPair || score > bestPair.score) {
      bestPair = { withdraw: bestOutput, deliverTarget: deliverTarget.target, resource, score };
    }
  }
  if (!bestPair) return undefined;

  const withdraw: Task = { kind: "withdraw", target: bestPair.withdraw.target, resource: bestPair.resource };
  const deliver: Task = { kind: "transfer", target: bestPair.deliverTarget, resource: bestPair.resource };
  return fork(withdraw, deliver);
}

/**
 * Runs `creep`'s current persisted logistics Task one tick, planning a fresh one from Transport's
 * rate-ranked pool when idle (no task, or the persisted one no longer resolves — logisticsTaskRunner.ts's
 * runLogisticsTask already drops a dead reference). `otherTransportCreeps` should be every OTHER live
 * Transport creep in the same colony (see planTransportTask's own doc on why it's scanned fresh here
 * rather than passed as a cached map).
 */
export function runTransportTask(creep: Creep, otherTransportCreeps: readonly Creep[]): void {
  if (!creep.memory.logisticsTask) {
    const home = Game.rooms[creep.memory.home];
    if (!home) return; // no vision of home this tick — nothing to plan against
    const task = planTransportTask(creep, home, otherTransportCreeps);
    if (!task) return; // nothing in the pool right now
    creep.memory.logisticsTask = persistTask(task);
  } else if (!resolveTask(creep.memory.logisticsTask)) {
    // Dead reference (target vanished before this tick's runLogisticsTask call would have caught it) —
    // drop and let a later tick replan fresh rather than handing runLogisticsTask a task it would
    // immediately discard anyway; avoids a same-tick plan-then-immediately-invalidate cycle.
    creep.memory.logisticsTask = undefined;
    return;
  }

  runLogisticsTask(creep);
}
