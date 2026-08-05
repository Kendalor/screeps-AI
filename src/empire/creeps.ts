// The creep behaviour runner. Acts directly rather than returning intents, since travelTo keeps
// internal path state. Empire-scoped because it iterates Game.creeps directly, not a snapshot.

import {
  canCoFire,
  firstRunnableStep,
  fleeThreat,
  isGatherStep,
  nextStep,
  retreatIfDisarmed,
  runStep,
  type CreepState
} from "../behaviors/interpreter";
import { roleDef } from "../behaviors/roles";
import { runSteward } from "../behaviors/steward";
import { sweepEnRoute } from "../behaviors/sweep";
import { runTransport } from "../behaviors/transport";
import type { Step } from "../behaviors/types";
import { log } from "../lib/log";
import { wrapFn } from "../lib/profiler";

export const runCreepBehaviors = wrapFn(function runCreepBehaviors(): void {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.spawning) continue;
    // Diverted before the step-table dispatch: "transport" and "supply"'s ROLES entries deliberately
    // have empty steps (assignment comes from planLogistics via memory.logistics, not a static step
    // table — supply is planned through its own restricted provider/consumer view, see
    // logistics/graph.ts's supplyProviders/supplyConsumers), so falling into runOne would hit its
    // `def.steps.length === 0` early-return and do nothing.
    if (creep.memory.role === "transport" || creep.memory.role === "supply") {
      // Neither role runs through runOne's step table, so its flee check (gated on Role.flee) never
      // sees them — checked here instead, ahead of the same diversion, so a hauler running the
      // logistics allocator's own task retreats from an armed hostile exactly like a step-table hauler.
      if (fleeThreat(creep)) continue;
      runTransport(creep);
      continue;
    }
    // Same empty-steps diversion as transport above: assignment is threshold-based inside runSteward
    // itself, not a static step table.
    if (creep.memory.role === "steward") {
      runSteward(creep);
      continue;
    }
    runOne(creep);
  }
}, "creeps:runCreepBehaviors");

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

// True when memory.squadTargetPos is set and the creep isn't exactly there yet — mirrors moveToPos's own
// "arrived" check (interpreter.ts's runStep, case "moveToPos") so this and the real step agree on what
// counts as away. No target at all reads as NOT away (nothing to preempt toward).
function creepAwayFromSquadTargetPos(creep: Creep): boolean {
  const target = creep.memory.squadTargetPos;
  if (!target) return false;
  return creep.pos.roomName !== target.room || !creep.pos.isEqualTo(target.x, target.y);
}

// Forces moveToPos (at `posStep`) to run as this tick's primary step, bypassing the normal
// firstRunnableStep scan — see runOne's call site doc for why standStill actions can otherwise hold
// primary-step status forever once task.step lands on them. Mirrors runOne's own primary-step bookkeeping
// (task.step/task.target update, debug log, co-fired bonus step) so this reads as "the same dispatch,
// just aimed at a specific step" rather than a parallel code path.
function runMoveToPos(creep: Creep, steps: Step[], posStep: number, task: { step: number; target?: Id<_HasId> }): void {
  const result = runStep(creep, steps[posStep], undefined, true);
  const state: CreepState = { step: posStep, ...storeOf(creep), targetGone: false, didAct: result.didAct };
  const next = nextStep(steps, state);
  log.debugCreep(
    creep.name,
    `role=${creep.memory.role} step=${posStep}(moveToPos) acted(preempt) didAct=${result.didAct} target=${result.target ?? "-"} nextStep=${next}`
  );
  task.step = next;
  task.target = result.target;
  coFireBonusStep(creep, steps, posStep);
}

const runOne = wrapFn(function runOne(creep: Creep): void {
  const def = roleDef(creep.memory.role);
  if (!def || def.steps.length === 0) return;

  // Break off whatever this creep is doing and retreat if an armed hostile has closed within range —
  // checked before the step dispatch below (not woven into an individual step) so it pre-empts every
  // step in the table uniformly, not just moveToRoom's between-room travel.
  if (def.flee && fleeThreat(creep)) return;

  // A defender that has lost every RANGED_ATTACK part to damage can't fight back at all — pull it out
  // toward a healer (or home) instead of running attackStep, which would just keep it standing in the
  // fight for zero return. Checked only for "defender" (not gated via a Role flag like Role.flee) since
  // this is about a body that's been shot down to a husk, not a role that was never meant to fight.
  if (creep.memory.role === "defender" && retreatIfDisarmed(creep)) return;

  const task = (creep.memory.task ??= { step: 0 });
  if (task.step >= def.steps.length) task.step = 0; // steps changed under us

  // moveToPos always wins over a standStill step (heal/attack — see Step.standStill's doc) once the
  // creep has drifted from its assigned position: a squadMate/hostile target that resolves to something
  // ALREADY in range (trivially true for heal — "squadMate" includes the acting creep itself, so an
  // undamaged healer can always self-heal a no-op) reports acted:true every tick regardless of position,
  // which would otherwise let it hold primary-step status forever once task.step lands there — the
  // ordinary forward-scanning dispatch below has no reason to ever prefer moveToPos again, since
  // firstRunnableStep only looks forward from task.step and a "move"-kind step never self-completes (see
  // interpreter.ts's isComplete). Confirmed live on shard0 (2026-08-05): two drain healers sat exactly
  // one tile from their assigned formation slot, self-healing every tick, never covering that last tile.
  // Checked ahead of the normal dispatch specifically because standStill exists to stop heal/attack from
  // ever DRIVING travel — it must not also let them silently outrank the step whose entire job is travel.
  const posStep = def.steps.findIndex(s => s.do === "moveToPos");
  if (posStep !== -1 && creepAwayFromSquadTargetPos(creep)) {
    runMoveToPos(creep, def.steps, posStep, task);
    return;
  }

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
    const result = runStep(creep, def.steps[step], task.target, !def.steps[step].standStill, { doNotBlockRoads: def.doNotBlockRoads });

    if (result.acted) {
      const state: CreepState = { step, ...storeOf(creep), targetGone: false, didAct: result.didAct };
      const next = nextStep(def.steps, state);
      log.debugCreep(
        creep.name,
        `role=${creep.memory.role} step=${step}(${def.steps[step].do}) acted didAct=${result.didAct} target=${result.target ?? "-"} nextStep=${next}`
      );
      task.step = next;
      // Carried to next tick so the creep finishes what it started rather than re-picking nearest target every tick.
      task.target = result.target;
      coFireBonusStep(creep, def.steps, step);
      return;
    }

    step = (step + 1) % def.steps.length;
    task.target = undefined;
  }

  // Every step in the loop came back with nothing to resolve — truly idle this tick.
  log.debugCreep(creep.name, `role=${creep.memory.role} idle — every step had nothing to resolve`);
  task.step = step;
}, "creeps:runOne");

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
