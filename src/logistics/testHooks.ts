// Console-callable hooks for driving standalone logistics infra from an integration test, before it's
// wired into any live role's planner — see logistics/task.ts's and logistics/request.ts's headers. Not
// player-facing commands (deliberately absent from commands/console.ts's registered/help() list): these
// exist purely as the mockup-server test seam, called via BootedColony's bot.console(). Actually running
// an assigned Task chain forward is main.ts's runLogisticsTasks, invoked unconditionally every tick —
// independent of these one-shot hooks and of the live role dispatch table.

import { fork, persistTask, type Task } from "./task";
import { pickBestRequest, requestOutput } from "./request";

declare global {
  var __assignLogisticsTaskChain: (creepName: string, legs: { kind: "withdraw" | "transfer"; targetId: string; resource: ResourceConstant }[]) => string;
  var __pickLogisticsRequest: (
    creepName: string,
    candidates: { targetId: string; resource: ResourceConstant; amount: number; multiplier?: number }[]
  ) => string;
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
}
