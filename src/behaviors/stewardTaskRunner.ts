// Runs a Steward-role creep's rate-ranked anchor link/storage/terminal pool (gh #51, ADR 0008): picks the
// best LogisticsRequest via logistics/stewardRegister.ts's self-registration + request.ts's
// scoreRequest/pickBestRequest (gh #46), then — for a delivery request (controller-link top-up, terminal
// rebalance) — evaluates a direct-vs-via-storage-buffer route via route.ts's evaluateRoutes/pickBestRoute
// (gh #47) exactly as Transport's pool will, before driving the creep onto the winning Task chain (gh #45's
// fork/parent primitive), reusing behaviors/actions.ts's withdraw/transfer leaves the same way
// supplyTaskRunner.ts/logisticsTaskRunner.ts do. No scoring or buffer-detour logic is reimplemented here —
// see stewardRegister.ts's header for why each leg is expressed as a request instead of a threshold check.
//
// Live since gh #54 (ADR 0008): empire/creeps.ts's dispatchSteward calls runStewardTask once a Steward
// creep is parked on its anchor tile, replacing stewardBehavior.ts's hand-tuned threshold cascade outright
// (deleted in that same commit — see its removal for why no dead-in-place remnant was left: the old logic
// was fully self-contained, no other module read its constants or shared its call path). Also still
// reachable from the test-only __runStewardTask console hook (logistics/testHooks.ts), same pattern
// supplyTaskRunner.ts established for __runSupplyTask.

import { registerStewardRequests } from "../logistics/stewardRegister";
import { pickBestRequest, scoreRequest, type LogisticsRequest } from "../logistics/request";
import { evaluateRoutes, pickBestRoute, type Buffer } from "../logistics/route";
import { fork, persistTask, resolveTask, type Task } from "../logistics/task";
import { transferTo, withdrawOrPickup } from "./actions";

// Every distinct resource this tick's Steward pool has a request for — mirrors
// transportTaskRunner.ts's resourcesInPool exactly (gh #59: Steward's pool stopped being energy-only once
// registerStewardRequests started registering a terminal-rebalance leg per BOOST_TARGETS resource, not
// just energy — see that function's own doc).
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

// Mirrors logisticsTaskRunner.ts's/supplyTaskRunner.ts's isTaskComplete exactly — same Task shape, same
// completion rule (a withdraw leg is done once the creep can't carry more, a transfer leg once it has
// nothing left to give).
function isTaskComplete(creep: Creep, task: Task): boolean {
  if (task.kind === "withdraw") return creep.store.getFreeCapacity(task.resource) === 0;
  return creep.store.getUsedCapacity(task.resource) === 0;
}

function targetExhausted(task: Task): boolean {
  const target = task.target as unknown as RoomObject;
  if (task.kind === "withdraw") {
    const asStore = target as { store?: { getUsedCapacity?(r: ResourceConstant): number | null } };
    if (typeof asStore.store?.getUsedCapacity === "function") return (asStore.store.getUsedCapacity(task.resource) ?? 0) <= 0;
    return false;
  }
  const asStore = target as { store?: { getFreeCapacity?(r: ResourceConstant): number | null } };
  if (typeof asStore.store?.getFreeCapacity === "function") return (asStore.store.getFreeCapacity(task.resource) ?? 0) <= 0;
  return false;
}

function act(creep: Creep, task: Task): { didAct: boolean } {
  const target = task.target as unknown as RoomObject;
  return task.kind === "withdraw" ? withdrawOrPickup(creep, target, task.resource) : transferTo(creep, target, task.resource);
}

/** Live handles for the anchor link/storage/terminal triangle — the one set of Game.* lookups this module
 * needs, mirroring stewardBehavior.ts's own anchorLink()/controllerLink() helpers. `controllerLink` is
 * read the same way stewardBehavior.ts does (ColonyMemory.links.controller — out of Steward's reach at the
 * controller, not the anchor), so this module doesn't re-derive its position either. */
export interface StewardTriangle {
  link?: StructureLink;
  controllerLink?: StructureLink;
  storage?: StructureStorage;
  terminal?: StructureTerminal;
}

function anchorLink(room: Room, anchor: RoomPosition): StructureLink | undefined {
  return anchor
    .findInRange<StructureLink>(FIND_MY_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_LINK })
    .find(l => l.room.name === room.name);
}

function controllerLink(home: string): StructureLink | undefined {
  const id = typeof Memory !== "undefined" ? Memory.colonies?.[home]?.links?.controller : undefined;
  return id ? (Game.getObjectById(id) ?? undefined) : undefined;
}

/** Resolves the live triangle for `creep`'s home room, the same live-object lookups stewardBehavior.ts
 * performs each tick — exposed standalone so a test can also build one directly for a target not yet tied
 * to a creep (e.g. picking a request before any creep exists). */
export function resolveStewardTriangle(creep: Creep, anchor: RoomPosition): StewardTriangle {
  const room = creep.room;
  return {
    link: anchorLink(room, anchor),
    controllerLink: controllerLink(creep.memory.home),
    storage: room.storage,
    terminal: room.terminal
  };
}

/**
 * Builds a ready-to-assign Task chain for `creep` from Steward's rate-ranked pool: registers every live
 * request (stewardRegister.ts), then races EVERY resource present in the pool against every other's best
 * pick (pickBestRequest per resource, request.ts, gh #46 — a genuine cross-resource race, the same shape
 * transportTaskRunner.ts's planTransportTask uses via resourcesInPool, not a fixed energy-first order: an
 * earlier version of this codebase's Transport pool tried exactly that fixed-order shortcut and it meant a
 * long-starved mineral pickup could never outrank even a trivial energy top-up — see that module's own doc
 * for the full incident). gh #59 made this matter for Steward specifically: registerStewardRequests now
 * registers a terminal-rebalance leg per BOOST_TARGETS resource (GO/GHO2/XGHO2/...) alongside energy, not
 * just energy — ranking only ever against RESOURCE_ENERGY here would silently build those mineral requests
 * and then never act on them, exactly the kind of bug Transport's own history already warns about.
 *
 * For a delivery request (positive amount: controller-link top-up or terminal rebalance) this evaluates a
 * buffer detour via storage using route.ts's pickBestRoute (gh #47), same as Transport's pool does. A
 * withdraw-side request (link drain) has a fixed, known delivery target (storage — see
 * stewardRegister.ts's own doc) rather than a second ranking pass, since the PRD/ADR is silent on treating
 * storage's own "want" as competing. Undefined when the pool has nothing to offer or nothing is reachable.
 */
export function planStewardTask(creep: Creep, triangle: StewardTriangle): Task | undefined {
  // gh #59 decision 6: an empire-matched transfer's reservation, refreshed every empire-logistics pass
  // (~11 ticks) into ColonyMemory.empireReservations — read fresh here rather than threaded through
  // StewardTriangle, since it's a Memory fact about the colony, not a live Game.* object like the rest of
  // the triangle.
  const empireReservations = Memory.colonies?.[creep.memory.home]?.empireReservations ?? {};
  const requests = registerStewardRequests(triangle.link, triangle.controllerLink, triangle.storage, triangle.terminal, empireReservations);
  if (requests.length === 0) return undefined;

  const distanceTo = (target: LogisticsRequest["target"]): number => creep.pos.getRangeTo(target.pos);
  let best: LogisticsRequest | undefined;
  let bestScore = -Infinity;
  for (const resource of resourcesInPool(requests)) {
    const candidate = pickBestRequest(requests, resource, distanceTo);
    if (!candidate) continue;
    const candidateScore = scoreRequest(candidate, distanceTo(candidate.target));
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  if (!best) return undefined;

  if (best.amount < 0) {
    // Output request (link drain): the resource has somewhere to give, storage is the fixed sink — mirrors
    // stewardBehavior.ts's drain leg exactly (withdraw link, deliver storage), no buffer detour to
    // evaluate on the giving side (route.ts's evaluateRoutes only scores detours for requestInput —
    // see that module's own doc).
    if (!triangle.storage) return undefined;
    const withdraw: Task = { kind: "withdraw", target: best.target, resource: best.resource };
    const deliver: Task = { kind: "transfer", target: triangle.storage, resource: best.resource };
    return fork(withdraw, deliver);
  }

  // Input request (controller-link top-up, energy terminal rebalance, or — gh #59 — a mineral's storage
  // want): a real delivery, so a via-buffer detour is worth evaluating the same way Transport's pool does
  // (route.ts's pickBestRoute). Both storage and terminal are offered as candidate buffers, each EXCLUDING
  // itself when it's the request's own delivery target — a same-structure detour is a no-op, not a real
  // route (see evaluateRoutes' own doc: it only ever compares candidates, so an empty list here is fine,
  // never a crash). This matters concretely for registerMineralStorageWantRequest: storage is the target,
  // so ONLY the terminal is offered as a buffer — real bug fixed here, confirmed live: excluding storage
  // from the buffer list (correct) previously left the list EMPTY instead of substituting the terminal, so
  // an idle Steward creep with 0 carried could never actually fetch a mineral sitting in the terminal to
  // fill storage's want — evaluateRoutes' direct-only route delivers 0 (capped by `carrying`), and with no
  // buffer candidate at all, the creep was handed an inert zero-amount transfer task and looked idle.
  const candidateBuffers = [triangle.storage, triangle.terminal] as (StructureStorage | StructureTerminal | undefined)[];
  const buffers: Buffer[] = candidateBuffers
    .filter((b): b is StructureStorage | StructureTerminal => b !== undefined && b.id !== best.target.id)
    .map(b => b as unknown as Buffer);
  const carrying = creep.store.getUsedCapacity(best.resource);
  const capacity = carrying + creep.store.getFreeCapacity(best.resource);
  const picked = pickBestRoute(best, creep.pos, buffers, carrying, capacity, (a, b) => a.getRangeTo(b));
  return picked?.task;
}

// evaluateRoutes is re-exported so a test can inspect the full scored candidate set (e.g. to assert a
// via-storage detour strictly beat direct) without reaching into planStewardTask's internals.
export { evaluateRoutes };
export type { LogisticsRequest };

/** Runs `creep`'s current persisted Steward task one tick, planning a fresh one from the rate-ranked pool
 * when idle — same re-plan-only-when-idle shape as supplyTaskRunner.ts's runSupplyTask. */
export function runStewardTask(creep: Creep, triangle: StewardTriangle): void {
  let task: Task | undefined;
  if (creep.memory.logisticsTask) {
    task = resolveTask(creep.memory.logisticsTask) ?? undefined;
    if (!task) creep.memory.logisticsTask = undefined; // dead reference — drop and replan below
  }
  if (!task) {
    task = planStewardTask(creep, triangle);
    if (!task) return; // nothing in Steward's pool to do this tick
  }

  const result = act(creep, task);
  if (result.didAct && (isTaskComplete(creep, task) || targetExhausted(task))) {
    creep.memory.logisticsTask = task.parent ? persistTask(task.parent) : undefined;
  } else {
    creep.memory.logisticsTask = persistTask(task);
  }
}
