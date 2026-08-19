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
import { pickBestRequest, type LogisticsRequest } from "../logistics/request";
import { evaluateRoutes, pickBestRoute, type Buffer } from "../logistics/route";
import { fork, persistTask, resolveTask, type Task } from "../logistics/task";
import { transferTo, withdrawOrPickup } from "./actions";

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
 * request (stewardRegister.ts), picks the best-scoring one via pickBestRequest (request.ts, gh #46) — no
 * reimplementation, same scorer Transport's pool will use — and for a delivery request (positive amount:
 * controller-link top-up or terminal rebalance) evaluates a buffer detour via storage using
 * route.ts's pickBestRoute (gh #47), same as Transport's pool will. A withdraw-side request (link drain)
 * has a fixed, known delivery target (storage — see stewardRegister.ts's own doc) rather than a second
 * ranking pass, since there both PRD/ADR is silent on treating storage's own "want" as competing.
 * Undefined when the pool has nothing to offer or nothing is reachable.
 */
export function planStewardTask(creep: Creep, triangle: StewardTriangle): Task | undefined {
  const requests = registerStewardRequests(triangle.link, triangle.controllerLink, triangle.storage, triangle.terminal);
  if (requests.length === 0) return undefined;

  const best = pickBestRequest(requests, RESOURCE_ENERGY, target => creep.pos.getRangeTo(target.pos));
  if (!best) return undefined;

  if (best.amount < 0) {
    // Output request (link drain): the link has energy to give, storage is the fixed sink — mirrors
    // stewardBehavior.ts's drain leg exactly (withdraw link, deliver storage), no buffer detour to
    // evaluate on the giving side (route.ts's evaluateRoutes only scores detours for requestInput —
    // see that module's own doc).
    if (!triangle.storage) return undefined;
    const withdraw: Task = { kind: "withdraw", target: best.target, resource: RESOURCE_ENERGY };
    const deliver: Task = { kind: "transfer", target: triangle.storage, resource: RESOURCE_ENERGY };
    return fork(withdraw, deliver);
  }

  // Input request (controller-link top-up or terminal rebalance): a real delivery, so a via-storage buffer
  // detour is worth evaluating the same way Transport's pool will (route.ts's pickBestRoute).
  const buffers: Buffer[] = triangle.storage ? [triangle.storage] : [];
  const carrying = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  const capacity = carrying + creep.store.getFreeCapacity(RESOURCE_ENERGY);
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
