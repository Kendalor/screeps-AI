// The creep framework (docs/rewrite-skeleton.md §5). The step-advancement
// decision is a pure function (nextStep) so it is unit-testable without a
// creep; runStep (added next) is the thin actuator that resolves the target
// and calls the game API / travelTo.

import { resolveTarget } from "./targets";
import type { Step, TargetSpec } from "./types";

// Gathering steps fill the store; spending steps drain it. This single table
// replaces the per-job completion conditions scattered across the old jobs.
type StepKind = "gather" | "spend";

const STEP_KIND: Record<Step["do"], StepKind> = {
  harvest: "gather",
  withdraw: "gather",
  pickup: "gather",
  transfer: "spend",
  build: "spend",
  repair: "spend",
  upgrade: "spend",
  // movement steps complete when arrived; treated as spend so an empty store
  // (or arrival, handled in runStep) advances them. sit never self-completes.
  moveToRoom: "spend",
  sit: "spend"
};

/** The creep facts the completion rules depend on — a snapshot, not the creep. */
export interface CreepState {
  step: number; // current index into the role's step list
  free: number; // store free capacity
  used: number; // store used capacity
  targetGone: boolean; // the locked target no longer resolves
}

/**
 * Given the role's steps and the creep's current state, return the index of the
 * step the creep should run this tick. Wraps around the step list.
 */
export function nextStep(steps: Step[], s: CreepState): number {
  if (isComplete(steps[s.step], s)) {
    return (s.step + 1) % steps.length;
  }
  return s.step;
}

function isComplete(step: Step, s: CreepState): boolean {
  if (s.targetGone) return true;
  const kind = STEP_KIND[step.do];
  if (kind === "gather") return s.free === 0; // store full
  return s.used === 0; // spending: store empty
}

// --- acting half (touches the live API) --------------------------------------
// Runs one step for one creep: resolve/validate the target, then act in range
// or travelTo. Returns whether the step had a valid target this tick — the
// dispatch (systems/creeps.ts) uses that to set CreepState.targetGone so a step
// with nothing to do advances instead of stalling (the old jobs' cancel path).
// build/repair/upgrade act at range 3; everything else at range 1.

export function runStep(creep: Creep, step: Step): boolean {
  switch (step.do) {
    case "harvest":
      return actOn(creep, step.from, t => creep.harvest(t as Source));
    case "withdraw":
      return actOn(creep, step.from, t =>
        creep.withdraw(t as Structure & { store: StoreDefinition }, step.resource ?? RESOURCE_ENERGY)
      );
    case "pickup":
      return actOn(creep, step.from, t => creep.pickup(t as Resource));
    case "transfer":
      return actOn(creep, step.to, t =>
        creep.transfer(t as Structure & { store: StoreDefinition }, step.resource ?? RESOURCE_ENERGY)
      );
    case "build":
      return actOn(creep, step.at ?? { find: "constructionSite" }, t => creep.build(t as ConstructionSite), 3);
    case "repair":
      return actOn(creep, step.at, t => creep.repair(t as Structure), 3);
    case "upgrade":
      return actOn(creep, { find: "controller" }, t => creep.upgradeController(t as StructureController), 3);
    case "moveToRoom":
      if (creep.room.name !== step.room) {
        creep.travelTo(new RoomPosition(25, 25, step.room));
      }
      return true;
    case "sit":
      creep.travelTo(new RoomPosition(step.pos.x, step.pos.y, creep.room.name));
      return true;
  }
}

// Resolve the target for `spec`; if in range run `action`, else travel. Returns
// false when no target resolves (the step has nothing to do this tick).
function actOn(creep: Creep, spec: TargetSpec, action: (t: RoomObject) => number, range = 1): boolean {
  const target = resolveTarget(creep, spec);
  if (!target) return false;
  if (creep.pos.inRangeTo(target as { pos: RoomPosition }, range)) {
    action(target);
  } else {
    creep.travelTo(target as { pos: RoomPosition });
  }
  return true;
}
