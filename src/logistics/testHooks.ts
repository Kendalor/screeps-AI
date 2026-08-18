// Console-callable hook for driving the new logistics Task primitive (gh #45) from an integration test,
// before it's wired into any live role's planner — see logistics/task.ts's header. Not a player-facing
// command (deliberately absent from commands/console.ts's registered/help() list): this exists purely as
// the mockup-server test seam, called via BootedColony's bot.console(). Actually running the assigned
// chain forward is main.ts's runLogisticsTasks, invoked unconditionally every tick — independent of this
// one-shot assignment hook and of the live role dispatch table.

import { fork, persistTask, type Task } from "./task";

declare global {
  var __assignLogisticsTaskChain: (creepName: string, legs: { kind: "withdraw" | "transfer"; targetId: string; resource: ResourceConstant }[]) => string;
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
}
