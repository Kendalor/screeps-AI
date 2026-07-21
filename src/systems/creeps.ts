// Behavior interpreter dispatch, tier 1 (docs/rewrite-skeleton.md §2, §5).
//
// Unlike the other systems this one acts directly rather than returning intents:
// the skeleton's pragmatic exception (§1) is that creep movement/action goes
// through the interpreter, since travelTo keeps internal path state and purity
// is enforced at room-level decisions, not per-creep pathfinding. So this
// returns no intents — its effect is the runStep calls inside.

import { firstRunnableStep, nextStep, runStep, type CreepState } from "../behaviors/interpreter";
import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import type { EmpireSnapshot } from "../snapshot/types";

export function runCreepBehaviors(_snap: EmpireSnapshot): Intent[] {
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

  // A step advanced onto at the end of last tick (e.g. "upgrade" right after
  // "transfer" emptied the store) can already be done before it ever acts —
  // skip straight to one that actually has something to do, in the same tick,
  // rather than wasting a tick walking toward/acting on a no-op step.
  const runnable = firstRunnableStep(def.steps, task.step, {
    free: creep.store.getFreeCapacity(),
    used: creep.store.getUsedCapacity()
  });
  if (runnable !== task.step) task.target = undefined; // lock belonged to the skipped step
  task.step = runnable;

  // Act this tick, reusing last tick's locked target if it is still valid.
  // Whether a target resolved feeds the completion check so a step with nothing
  // to do advances rather than stalling.
  const result = runStep(creep, def.steps[task.step], task.target);

  const state: CreepState = {
    step: task.step,
    free: creep.store.getFreeCapacity(),
    used: creep.store.getUsedCapacity(),
    targetGone: !result.acted
  };
  task.step = nextStep(def.steps, state);

  // Carry the lock to next tick so the creep finishes what it started rather
  // than re-picking the nearest target every tick (#23). The lock is validated
  // against the step's spec on reuse, so it is safe to hold across a step
  // change: a target the new step cannot use is dropped there.
  task.target = result.target;
}
