// The creep behaviour runner. Acts directly rather than returning intents, since travelTo keeps
// internal path state. Empire-scoped because it iterates Game.creeps directly, not a snapshot.

import {
  canCoFire,
  firstRunnableStep,
  isGatherStep,
  nextStep,
  runStep,
  type CreepState
} from "../behaviors/interpreter";
import { roleDef } from "../behaviors/roles";
import { sweepEnRoute } from "../behaviors/sweep";
import type { Step } from "../behaviors/types";

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

// True when the creep already stands in action range (1) of its locked target — it has arrived and
// should work the target, not detour to a bystander pile. No lock, or a dead lock, counts as not there.
function atLockedTarget(creep: Creep, locked: Id<_HasId> | undefined): boolean {
  if (!locked) return false;
  const obj = Game.getObjectById(locked) as { pos?: RoomPosition } | null;
  return !!obj?.pos && creep.pos.inRangeTo(obj.pos, 1);
}

function runOne(creep: Creep): void {
  const def = roleDef(creep.memory.role);
  if (!def || def.steps.length === 0) return;

  const task = (creep.memory.task ??= { step: 0 });
  if (task.step >= def.steps.length) task.step = 0; // steps changed under us

  // Skip straight to a step with something to do, rather than wasting a tick on one already complete on arrival.
  let step = firstRunnableStep(def.steps, task.step, storeOf(creep));
  if (step !== task.step) task.target = undefined; // lock belonged to the skipped step

  // Opportunistic en-route pickup: only while *travelling* to collect — the runnable step gathers and
  // the creep is not yet adjacent to its committed target (else it'd keep grabbing a tiny roadside pile
  // instead of withdrawing the container it arrived at). Grab / step toward a loose pile and spend the
  // tick on that; the primary gather re-issues its own path next tick (see behaviors/sweep.ts).
  if (def.sweep && isGatherStep(def.steps[step]) && !atLockedTarget(creep, task.target) && sweepEnRoute(creep)) {
    return;
  }

  // A dead target costs no API call, so retry the next step immediately; bounded to one full pass.
  for (let i = 0; i < def.steps.length; i++) {
    const result = runStep(creep, def.steps[step], task.target);

    if (result.acted) {
      const state: CreepState = { step, ...storeOf(creep), targetGone: false, didAct: result.didAct };
      task.step = nextStep(def.steps, state);
      // Carried to next tick so the creep finishes what it started rather than re-picking nearest target every tick.
      task.target = result.target;
      coFireBonusStep(creep, def.steps, step);
      return;
    }

    step = (step + 1) % def.steps.length;
    task.target = undefined;
  }

  // Every step in the loop came back with nothing to resolve — truly idle this tick.
  task.step = step;
}

// The engine runs harvest/build/repair/upgrade (one WORK-part pipeline, mutually exclusive) independently
// of transfer/withdraw/pickup (each its own CARRY-part pipeline) and of movement — so a second step from a
// different pipeline than the one just run can also act this same tick (e.g. a miner harvesting and
// transferring in one tick). Unlocked deliberately: it re-resolves its target fresh every tick rather than
// persisting into `task`, which would fight the primary step's own lock/progression bookkeeping.
//
// allowTravel:false (runStep's last argument): travelTo keeps one piece of state per creep
// (Memory._trav), not one per pipeline, so letting a bonus step travel would call travelTo a second
// time this same tick and silently overwrite the primary step's own in-flight destination — every
// tick, forever, since the primary step never gets to keep a path long enough to make progress.
// Observed live: upgraders with an empty carry looping near a moving hauler instead of ever reaching
// the controller, because "withdraw from hauler" co-fired every tick and its travelTo call always won
// (last move() intent issued is the only one the engine honours). A bonus step whose target is out of
// range now simply does nothing this tick instead of chasing it.
function coFireBonusStep(creep: Creep, steps: Step[], primaryStep: number): void {
  for (let i = 1; i < steps.length; i++) {
    const idx = (primaryStep + i) % steps.length;
    const step = steps[idx];
    if (!canCoFire(steps[primaryStep], step)) continue;
    if (runStep(creep, step, undefined, false).acted) return;
  }
}
