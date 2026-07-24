// The creep behaviour runner. Acts directly rather than returning intents, since travelTo keeps
// internal path state. Empire-scoped because it iterates Game.creeps directly, not a snapshot.

import { firstRunnableStep, nextStep, runStep, type CreepState } from "../behaviors/interpreter";
import { roleDef } from "../behaviors/roles";

export function runCreepBehaviors(): void {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.spawning) continue;
    runOne(creep);
  }
}

function storeOf(creep: Creep): { free: number; used: number } {
  return { free: creep.store.getFreeCapacity(), used: creep.store.getUsedCapacity() };
}

function runOne(creep: Creep): void {
  const def = roleDef(creep.memory.role);
  if (!def || def.steps.length === 0) return;

  const task = (creep.memory.task ??= { step: 0 });
  if (task.step >= def.steps.length) task.step = 0; // steps changed under us

  // Skip straight to a step with something to do, rather than wasting a tick on one already complete on arrival.
  let step = firstRunnableStep(def.steps, task.step, storeOf(creep));
  if (step !== task.step) task.target = undefined; // lock belonged to the skipped step

  // A dead target costs no API call, so retry the next step immediately; bounded to one full pass.
  for (let i = 0; i < def.steps.length; i++) {
    const result = runStep(creep, def.steps[step], task.target);

    if (result.acted) {
      const state: CreepState = { step, ...storeOf(creep), targetGone: false, didAct: result.didAct };
      task.step = nextStep(def.steps, state);
      // Carried to next tick so the creep finishes what it started rather than re-picking nearest target every tick.
      task.target = result.target;
      return;
    }

    step = (step + 1) % def.steps.length;
    task.target = undefined;
  }

  // Every step in the loop came back with nothing to resolve — truly idle this tick.
  task.step = step;
}
