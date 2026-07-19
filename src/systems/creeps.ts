// Behavior interpreter dispatch, tier 1 (docs/rewrite-skeleton.md §2, §5).
//
// Unlike the other systems this one acts directly rather than returning intents:
// the skeleton's pragmatic exception (§1) is that creep movement/action goes
// through the interpreter, since travelTo keeps internal path state and purity
// is enforced at room-level decisions, not per-creep pathfinding. So this
// returns no intents — its effect is the runStep calls inside.

import { nextStep, runStep, type CreepState } from "../behaviors/interpreter";
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

  // Act this tick; whether a target resolved feeds the completion check so a
  // step with nothing to do advances rather than stalling.
  const hadTarget = runStep(creep, def.steps[task.step]);

  const state: CreepState = {
    step: task.step,
    free: creep.store.getFreeCapacity(),
    used: creep.store.getUsedCapacity(),
    targetGone: !hadTarget
  };
  task.step = nextStep(def.steps, state);
}
