// Runs a Steward-role creep's rate-ranked anchor link/storage/terminal pool (gh #51, ADR 0008, gh #59):
// builds every live LogisticsRequest via logistics/stewardRegister.ts's self-registration, then finds the
// single best-scoring matched output+input pair via logistics/greedyMatch.ts's pickBestPair — the SAME
// greedy cross-resource pairing algorithm Transport's pool uses (behaviors/transportTaskRunner.ts), so
// both drive their own request pool through identical matching logic, differing only in how each builds
// its pool. Drives the creep onto the winning Task chain (gh #45's fork/parent primitive), reusing
// behaviors/actions.ts's withdraw/transfer leaves the same way supplyTaskRunner.ts/logisticsTaskRunner.ts
// do. No scoring/pairing logic is reimplemented here — see stewardRegister.ts's header for why each leg is
// expressed as a request instead of a threshold check, and greedyMatch.ts's header for the pairing rule
// itself (a resource is only ever a candidate if BOTH a real output and a real input exist for it).
//
// Live since gh #54 (ADR 0008): empire/creeps.ts's dispatchSteward calls runStewardTask once a Steward
// creep is parked on its anchor tile, replacing stewardBehavior.ts's hand-tuned threshold cascade outright
// (deleted in that same commit — see its removal for why no dead-in-place remnant was left: the old logic
// was fully self-contained, no other module read its constants or shared its call path). Also still
// reachable from the test-only __runStewardTask console hook (logistics/testHooks.ts), same pattern
// supplyTaskRunner.ts established for __runSupplyTask.

import { registerStewardRequests } from "../logistics/stewardRegister";
import type { LogisticsRequest } from "../logistics/request";
import { pickBestPair } from "../logistics/greedyMatch";
import { fork, persistTask, resolveTask, type Task } from "../logistics/task";
import { transferTo, withdrawOrPickup } from "./actions";
import { log } from "../lib/log";

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
 * request (stewardRegister.ts), then finds the single best-scoring matched pair via the same greedy
 * cross-resource pairing algorithm Transport's pool uses (logistics/greedyMatch.ts's pickBestPair, gh #59
 * — see that module's header for the incident this fixes: scoring each resource's best request in
 * isolation, with no check that a real opposite-signed counterpart exists, let a permanently-unfillable
 * want for a never-mined resource win the race by magnitude alone and starve every real, fulfillable
 * request behind it, confirmed live on the pserver). A resource with only a one-sided want or have is
 * never even a candidate — see pickBestPair's own doc.
 *
 * Steward's anchor creep sits permanently on a single fixed tile at range 1 from link/storage/terminal
 * (behaviors/roles/steward.ts's own header) — distance is a constant, not a real computation, so
 * `pickBestPair` is called with `() => 1` rather than a live `getRangeTo`, and there is no buffer-detour
 * evaluation to run afterward (route.ts's pickBestRoute): a matched pair already names the real withdraw
 * source AND real deliver target directly, and Steward's 3-structure triangle has no third stop to detour
 * through the way Transport's whole-room pool does. The link's drain/top-up legs pair against storage's own
 * implicit energy requests (stewardRegister.ts's registerStorageEnergyRequests) rather than a hardcoded
 * "always deliver to/from storage" assumption baked into this function — the pairing itself now decides
 * that, same as every other resource. Undefined when the pool has no fulfillable pair.
 */
export function planStewardTask(creep: Creep, triangle: StewardTriangle): Task | undefined {
  // gh #59 decision 6: an empire-matched transfer's reservation, refreshed every empire-logistics pass
  // (~11 ticks) into ColonyMemory.empireReservations — read fresh here rather than threaded through
  // StewardTriangle, since it's a Memory fact about the colony, not a live Game.* object like the rest of
  // the triangle.
  const empireReservations = Memory.colonies?.[creep.memory.home]?.empireReservations ?? {};
  const requests = registerStewardRequests(triangle.link, triangle.controllerLink, triangle.storage, triangle.terminal, empireReservations);
  log.debugCreep(
    creep.name,
    `pool(${requests.length}): ${requests.map(r => `${r.resource}=${r.amount}@${r.target.id.slice(0, 6)}`).join(", ")}`
  );
  if (requests.length === 0) return undefined;

  const pair = pickBestPair(requests, () => 1);
  if (!pair) {
    log.debugCreep(creep.name, "no matched pair — pool nonempty but nothing fulfillable");
    return undefined;
  }
  log.debugCreep(
    creep.name,
    `pair: ${pair.resource} output=${pair.output.target.id.slice(0, 6)} input=${pair.input.target.id.slice(0, 6)} score=${pair.score}`
  );

  const withdraw: Task = { kind: "withdraw", target: pair.output.target, resource: pair.resource };
  const deliver: Task = { kind: "transfer", target: pair.input.target, resource: pair.resource };
  return fork(withdraw, deliver);
}

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
    if (!task) {
      log.debugCreep(creep.name, "runStewardTask: planStewardTask returned undefined, nothing to do");
      return; // nothing in Steward's pool to do this tick
    }
  }

  const result = act(creep, task);
  log.debugCreep(
    creep.name,
    `act: kind=${task.kind} resource=${task.resource} target=${task.target.id.slice(0, 6)} didAct=${result.didAct} complete=${isTaskComplete(creep, task)} exhausted=${targetExhausted(task)}`
  );
  if (result.didAct && (isTaskComplete(creep, task) || targetExhausted(task))) {
    creep.memory.logisticsTask = task.parent ? persistTask(task.parent) : undefined;
  } else {
    creep.memory.logisticsTask = persistTask(task);
  }
}
