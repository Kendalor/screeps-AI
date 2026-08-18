// Console-callable hook for driving standalone logistics infra from an integration test, before it's
// wired into any live role's planner — see logistics/request.ts's header. Not a player-facing command
// (deliberately absent from commands/console.ts's registered/help() list): this exists purely as the
// mockup-server test seam, called via BootedColony's bot.console().

import { pickBestRequest, requestOutput } from "./request";

declare global {
  var __pickLogisticsRequest: (
    creepName: string,
    candidates: { targetId: string; resource: ResourceConstant; amount: number; multiplier?: number }[]
  ) => string;
}

export function installLogisticsTestHooks(): void {
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
