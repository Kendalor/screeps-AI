// nextStep decides step advancement as a pure function, testable without a creep; runStep is the actuator that touches the game API.

import { resolveTarget } from "./targets";
import type { Step, TargetSpec } from "./types";

// Gathering steps fill the store; spending steps drain it.
type StepKind = "gather" | "spend";

const STEP_KIND: Record<Step["do"], StepKind> = {
  harvest: "gather",
  withdraw: "gather",
  pickup: "gather",
  transfer: "spend",
  build: "spend",
  repair: "spend",
  upgrade: "spend",
  // Movement steps are treated as spend so arrival (handled in runStep) advances them; sit never self-completes.
  moveToRoom: "spend",
  sit: "spend"
};

export interface CreepState {
  step: number;
  free: number;
  used: number;
  targetGone: boolean; // the locked target no longer resolves
}

export function nextStep(steps: Step[], s: CreepState): number {
  if (isComplete(steps[s.step], s)) {
    return (s.step + 1) % steps.length;
  }
  return s.step;
}

// Skips a step landed on mid-tick that's already complete (e.g. arriving at "upgrade" right after "transfer" emptied the store).
// targetGone is never set here — that reflects a resolution attempt this step hasn't made yet.
export function firstRunnableStep(steps: Step[], from: number, store: { free: number; used: number }): number {
  for (let i = 0; i < steps.length; i++) {
    const idx = (from + i) % steps.length;
    if (!isComplete(steps[idx], { step: idx, ...store, targetGone: false })) return idx;
  }
  return from;
}

export function isComplete(step: Step, s: CreepState): boolean {
  if (s.targetGone) return true;
  // A `when: "empty"` step is a no-op while the creep still carries anything, so it counts as
  // already complete: nextStep advances past it and firstRunnableStep skips it. This is what makes
  // a loaded hauler keep delivering (cycling to the next spend step) instead of returning to pick
  // up more the moment one sink fills. The condition reads the creep's own store, never a target's.
  if (step.when === "empty" && s.used > 0) return true;
  const kind = STEP_KIND[step.do];
  if (kind === "gather") return s.free === 0;
  return s.used === 0;
}

// --- acting half (touches the live API) --------------------------------------
// Resolves/validates the target then acts in range or travelTo. build/repair/upgrade act at range 3; everything else at range 1.

// acted feeds CreepState.targetGone in the dispatcher so a step with nothing to do advances instead of stalling.
export interface StepResult {
  acted: boolean;
  target?: Id<_HasId>;
}

export function runStep(creep: Creep, step: Step, locked?: Id<_HasId>): StepResult {
  switch (step.do) {
    case "harvest":
      return actOn(creep, step.from, locked, t => creep.harvest(t as Source));
    case "withdraw":
      return actOn(creep, step.from, locked, t =>
        creep.withdraw(t as Structure & { store: StoreDefinition }, step.resource ?? RESOURCE_ENERGY)
      );
    case "pickup":
      return actOn(creep, step.from, locked, t => creep.pickup(t as Resource));
    case "transfer":
      return actOn(creep, step.to, locked, t =>
        creep.transfer(t as Structure & { store: StoreDefinition }, step.resource ?? RESOURCE_ENERGY)
      );
    case "build":
      return actOn(creep, step.at ?? { find: "constructionSite" }, locked, t => creep.build(t as ConstructionSite), 3);
    case "repair":
      return actOn(creep, step.at, locked, t => creep.repair(t as Structure), 3);
    case "upgrade":
      return actOn(creep, { find: "controller" }, locked, t => creep.upgradeController(t as StructureController), 3);
    case "moveToRoom":
      if (creep.room.name !== step.room) {
        creep.travelTo(new RoomPosition(25, 25, step.room));
      }
      return { acted: true };
    case "sit":
      creep.travelTo(new RoomPosition(step.pos.x, step.pos.y, creep.room.name));
      return { acted: true };
  }
}

function actOn(
  creep: Creep,
  spec: TargetSpec,
  locked: Id<_HasId> | undefined,
  action: (t: RoomObject) => number,
  range = 1
): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false };
  if (creep.pos.inRangeTo(target as { pos: RoomPosition }, range)) {
    action(target);
  } else {
    creep.travelTo(target as { pos: RoomPosition });
  }
  return { acted: true, target: (target as unknown as { id: Id<_HasId> }).id };
}
