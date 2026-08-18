// Console-callable hooks for driving standalone logistics infra from an integration test, before it's
// wired into any live role's planner — see logistics/task.ts's, logistics/request.ts's and
// logistics/route.ts's headers. Not player-facing commands (deliberately absent from
// commands/console.ts's registered/help() list): these exist purely as the mockup-server test seam,
// called via BootedColony's bot.console(). A creep's assigned Task chain (see logisticsTask) is only ever
// advanced by behaviors/logisticsTaskRunner.ts's runLogisticsTask, which has no live caller yet either
// (gh #52+) — these hooks assert on the picked route itself, not a multi-tick execution of it.

import { fork, persistTask, type Task } from "./task";
import { pickBestRequest, requestInput, requestOutput } from "./request";
import { pickBestRoute, type Buffer } from "./route";
import { runSupplyTask } from "../behaviors/supplyTaskRunner";

declare global {
  var __assignLogisticsTaskChain: (creepName: string, legs: { kind: "withdraw" | "transfer"; targetId: string; resource: ResourceConstant }[]) => string;
  var __pickLogisticsRequest: (
    creepName: string,
    candidates: { targetId: string; resource: ResourceConstant; amount: number; multiplier?: number }[]
  ) => string;
  var __pickLogisticsRoute: (
    creepName: string,
    targetId: string,
    resource: ResourceConstant,
    amount: number,
    bufferIds: string[]
  ) => string;
  var __runSupplyTask: (creepName: string) => string;
}

export function installLogisticsTestHooks(): void {
  // Builds a chain from `legs` (outermost/current task first) and assigns it to the named creep, so a
  // test can construct e.g. [withdraw, transfer] without importing fork()/persistTask() into engine-side
  // console expressions itself.
  global.__assignLogisticsTaskChain = (creepName, legs): string => {
    const creep = Game.creeps[creepName];
    if (!creep) return `no live creep named "${creepName}"`;
    if (legs.length === 0) return "no legs given";

    const tasks: Task[] = legs.map(leg => {
      const target = Game.getObjectById(leg.targetId as Id<_HasId>) as (_HasId & { pos: RoomPosition }) | null;
      if (!target) throw new Error(`no live object with id "${leg.targetId}"`);
      return { kind: leg.kind, target, resource: leg.resource };
    });

    let chain = tasks[tasks.length - 1];
    for (let i = tasks.length - 2; i >= 0; i--) chain = fork(tasks[i], chain);

    creep.memory.logisticsTask = persistTask(chain);
    return `assigned a ${legs.length}-leg task chain to ${creepName}`;
  };

  // Builds a LogisticsRequest per candidate (via requestOutput — each candidate is a "has resource
  // available" pile/container, matching gh #46's withdraw-side proof scope) and runs pickBestRequest
  // against the named creep's live position, writing the winning target's id to
  // CreepMemory.logisticsRequestPick so a test can assert on it without parsing console output.
  // getRangeTo is the real, live distance (not a stubbed/pure one) — matches gh #46's "no buffer detours
  // yet, direct-to-target only" scope, which needs no PathFinder search.
  global.__pickLogisticsRequest = (creepName, candidates): string => {
    const creep = Game.creeps[creepName];
    if (!creep) return `no live creep named "${creepName}"`;
    if (candidates.length === 0) return "no candidates given";

    const requests = candidates.map(c => {
      const target = Game.getObjectById(c.targetId as Id<_HasId>) as (_HasId & { pos: RoomPosition }) | null;
      if (!target) throw new Error(`no live object with id "${c.targetId}"`);
      return requestOutput(target, c.resource, c.amount, 0, c.multiplier ?? 1);
    });

    const resource = candidates[0].resource;
    const best = pickBestRequest(requests, resource, target => creep.pos.getRangeTo(target.pos));
    creep.memory.logisticsRequestPick = best ? String(best.target.id) : undefined;
    return best ? `picked ${String(best.target.id)}` : "no request picked";
  };

  // Builds one delivery LogisticsRequest (via requestInput — targetId WANTS `amount` of `resource`
  // delivered, gh #47's scope) and evaluates it via pickBestRoute against the named creep's live position,
  // its current carried amount of `resource`, and the live buffers named by `bufferIds` (storage/terminal,
  // whichever the test seeded). Assigns the winning route as a real Task chain to logisticsTask (same
  // shape __assignLogisticsTaskChain writes by hand) and records the leg sequence — outermost/current task
  // first — to logisticsRoutePick so a test can assert the actual route without decoding the persisted
  // Task tree itself. getRangeTo is real, live distance for both legs of a detour, matching
  // __pickLogisticsRequest's existing precedent of not stubbing distance.
  global.__pickLogisticsRoute = (creepName, targetId, resource, amount, bufferIds): string => {
    const creep = Game.creeps[creepName];
    if (!creep) return `no live creep named "${creepName}"`;

    const target = Game.getObjectById(targetId as Id<_HasId>) as (_HasId & { pos: RoomPosition }) | null;
    if (!target) throw new Error(`no live object with id "${targetId}"`);

    const buffers: Buffer[] = bufferIds.map(id => {
      const buffer = Game.getObjectById(id as Id<_HasId>) as unknown as Buffer | null;
      if (!buffer) throw new Error(`no live object with id "${id}"`);
      return buffer;
    });

    const request = requestInput(target, resource, amount);
    const carrying = creep.store.getUsedCapacity(resource) ?? 0;
    const capacity = carrying + (creep.store.getFreeCapacity(resource) ?? 0);
    const picked = pickBestRoute(request, creep.pos, buffers, carrying, capacity, (a, b) => a.getRangeTo(b));

    if (!picked) {
      creep.memory.logisticsTask = undefined;
      creep.memory.logisticsRoutePick = undefined;
      return "no route picked";
    }

    creep.memory.logisticsTask = persistTask(picked.task);
    const legIds: string[] = [];
    for (let task: Task | undefined = picked.task; task; task = task.parent) legIds.push(String(task.target.id));
    creep.memory.logisticsRoutePick = legIds;

    return picked.route.viaBuffer
      ? `picked a via-buffer route through ${String(picked.route.viaBuffer.id)} then ${targetId}`
      : `picked the direct route to ${targetId}`;
  };

  // Runs gh #50's standalone Supply self-registration/selection path (behaviors/supplyTaskRunner.ts) one
  // tick for the named creep — a test calls this every tick (via BootedColony.console() inside its own
  // onTick) to drive a multi-tick walk-then-fill sequence, since bot.console() itself is one-shot per
  // call. Not wired to any live role's dispatch table (see supplyTaskRunner.ts's header) — cutover is #53.
  global.__runSupplyTask = (creepName): string => {
    const creep = Game.creeps[creepName];
    if (!creep) return `no live creep named "${creepName}"`;
    runSupplyTask(creep);
    return `ran supply task for ${creepName}`;
  };
}
