// Plays a role's real Step[] against a FakeWorld for N ticks, mirroring empire/creeps.ts's runOne as
// closely as a colony-free harness can: firstRunnableStep skips a step already complete on arrival,
// then a bounded retry loop advances past any step that resolves nothing (a dead target costs no API
// call) until one actually acts, exactly like production — a simplified "call runStep once and stop"
// version gets stuck forever the moment a step (e.g. build with no site) never resolves but also never
// reports isComplete (see interpreter.ts's isComplete: a spend step only completes at used===0).

import { firstRunnableStep, nextStep, runStep, type CreepState } from "../../../../src/behaviors/interpreter";
import type { Step } from "../../../../src/behaviors/types";
import type { FakeWorld } from "./world";

export interface RunLog {
  step: number;
  result: ReturnType<typeof runStep>;
}

/**
 * Runs `steps` against `world` for `ticks` ticks, advancing world position between ticks the way the
 * engine moves a creep after travelTo() fires. Returns the full per-tick log for assertions on ordering.
 */
export function playRole(steps: Step[], world: FakeWorld, ticks: number): RunLog[] {
  const log: RunLog[] = [];
  let taskStep = 0;
  let locked: Id<_HasId> | undefined;

  for (let t = 0; t < ticks; t++) {
    const creep = world.creep();
    let step = firstRunnableStep(steps, taskStep, { free: world.store.free, used: world.store.energy });
    if (step !== taskStep) locked = undefined; // lock belonged to the step just skipped

    let result: ReturnType<typeof runStep> | undefined;
    for (let i = 0; i < steps.length; i++) {
      result = runStep(creep, steps[step], locked);
      if (result.acted) break;
      step = (step + 1) % steps.length;
      locked = undefined;
    }
    // Same shape as runOne's own fallback: every step resolved nothing this tick — idle in place.
    result ??= { acted: false, didAct: false };

    log.push({ step, result });

    if (result.acted) {
      const state: CreepState = { step, free: world.store.free, used: world.store.energy, targetGone: false, didAct: result.didAct };
      taskStep = nextStep(steps, state);
      locked = result.target;
    } else {
      taskStep = step;
    }
    world.advance();
  }
  return log;
}
