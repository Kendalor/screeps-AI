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

/**
 * What one step did this tick: whether it had anything to act on (`acted`, which
 * drives the targetGone completion rule) and the target it used, if any, for the
 * creep to lock onto next tick. Steps with no target (moveToRoom, sit) act
 * without locking, so the two facts are reported separately.
 */
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

// Resolve the target for `spec` — reusing `locked` when it is still valid — then
// act if in range, else travel toward it. Reports no target when nothing
// resolves, so the step has nothing to do this tick.
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
