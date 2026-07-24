// The creep behaviour runner — an Empire capability. Unlike the arbiters it acts directly rather
// than returning intents: travelTo keeps internal path state, so purity is enforced at room-level
// decisions, not per-creep pathfinding.
//
// Empire-scoped because it iterates Game.creeps directly rather than a snapshot, so it has no single
// colony to be scoped to. That is debt — creep behaviour is per-colony work that never got
// snapshot-ified — but it is the Empire's debt, not a system's.

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

  // A dead target (resolveTarget found nothing) costs no game API call, so retry with the next step
  // immediately rather than leaving the creep idle for a whole tick waiting for next tick's call.
  // Bounded to one full pass: if nothing in the loop resolves anywhere, the creep is genuinely idle
  // this tick, not stuck on a fixable failure.
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
