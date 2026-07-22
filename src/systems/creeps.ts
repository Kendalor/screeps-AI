// Unlike other systems, this one acts directly rather than returning intents: travelTo keeps internal path state, so purity
// is enforced at room-level decisions, not per-creep pathfinding.

import { firstRunnableStep, nextStep, runStep, type CreepState } from "../behaviors/interpreter";
import { roleDef } from "../behaviors/roles";
import type { Empire } from "../empire";
import type { Intent } from "../intents/types";

// Empire-scoped, unlike the colony planners: this iterates Game.creeps directly rather than a snapshot, so it has no
// colony to be scoped to. That is debt — creep behaviour is per-colony work that never got snapshot-ified.
export function runCreepBehaviors(_empire: Empire): Intent[] {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.spawning) continue;
    runOne(creep);
  }
  return [];
}

function runOne(creep: Creep): void {
  const def = roleDef(creep.memory.role);
  if (!def || def.steps.length === 0) return;

  const task = (creep.memory.task ??= { step: 0 });
  if (task.step >= def.steps.length) task.step = 0; // steps changed under us

  // Skip straight to a step with something to do, rather than wasting a tick on one already complete on arrival.
  const runnable = firstRunnableStep(def.steps, task.step, {
    free: creep.store.getFreeCapacity(),
    used: creep.store.getUsedCapacity()
  });
  if (runnable !== task.step) task.target = undefined; // lock belonged to the skipped step
  task.step = runnable;

  const result = runStep(creep, def.steps[task.step], task.target);

  const state: CreepState = {
    step: task.step,
    free: creep.store.getFreeCapacity(),
    used: creep.store.getUsedCapacity(),
    targetGone: !result.acted
  };
  task.step = nextStep(def.steps, state);

  // Carried to next tick so the creep finishes what it started rather than re-picking nearest target every tick.
  task.target = result.target;
}
