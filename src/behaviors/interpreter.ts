// nextStep decides step advancement as a pure function, testable without a creep; runStep is the actuator that touches the game API.

import { resolveTarget } from "./targets";
import type { Step, TargetSpec } from "./types";

// Gathering steps fill the store; spending steps drain it; movement steps complete only on arrival (signalled by runStep returning acted:false).
type StepKind = "gather" | "spend" | "move";

const STEP_KIND: Record<Step["do"], StepKind> = {
  harvest: "gather",
  withdraw: "gather",
  pickup: "gather",
  gather: "gather",
  transfer: "spend",
  build: "spend",
  repair: "spend",
  upgrade: "spend",
  moveToRoom: "move", // never self-completes on store state — arrival (targetGone) is the only completion
  sit: "move"
};

// The engine's per-tick action pipelines (docs.screeps.com/simultaneous-actions.html): harvest/build/
// repair/upgrade share one WORK-part pipeline and block each other. Every other method — each CARRY-part
// method (transfer/withdraw/pickup) and movement — is its own independent pipeline: none of them block
// the WORK pipeline or each other. (transfer reads the creep's store as it stood at the start of the
// tick, not energy the same tick's harvest just added.) Two steps from different pipelines may act in
// the same tick; "work" is the one pipeline name shared by more than one step type.
const WORK_PIPELINE = new Set<Step["do"]>(["harvest", "build", "repair", "upgrade"]);

function pipelineOf(step: Step["do"]): string {
  return WORK_PIPELINE.has(step) ? "work" : step; // non-work methods are each their own pipeline
}

/** Whether two steps may both act on the same creep in the same tick per the engine's pipeline rules. */
export function canCoFire(a: Step, b: Step): boolean {
  return pipelineOf(a.do) !== pipelineOf(b.do);
}

export interface CreepState {
  step: number;
  free: number;
  used: number;
  targetGone: boolean; // the locked target no longer resolves
  didAct: boolean; // whether the step's game-API call actually fired this tick, distinct from a target merely resolving; drives oneShot
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
    if (!isComplete(steps[idx], { step: idx, ...store, targetGone: false, didAct: false })) return idx;
  }
  return from;
}

export function isComplete(step: Step, s: CreepState): boolean {
  if (s.targetGone) return true;
  // "empty" steps no-op while the creep still carries anything, so a loaded hauler keeps delivering instead of returning early.
  if (step.when === "empty" && s.used > 0) return true;
  // oneShot completes the moment the action fires, not merely when a target resolves and travelTo begins.
  if (step.oneShot && s.didAct) return true;
  const kind = STEP_KIND[step.do];
  if (kind === "move") return false; // completes only via targetGone (arrival), handled above
  if (kind === "gather") return s.free === 0;
  return s.used === 0;
}

// --- acting half (touches the live API) --------------------------------------
// Resolves/validates the target then acts in range or travelTo. build/repair/upgrade act at range 3; everything else at range 1.

// acted: a target resolved (even mid-travel); didAct: the game-API call actually fired this tick (in range). Feeds oneShot.
export interface StepResult {
  acted: boolean;
  didAct: boolean;
  target?: Id<_HasId>;
}

// allowTravel: false for a co-fired bonus step (empire/creeps.ts's coFireBonusStep) — travelTo keeps
// one _trav slot per creep, not one per pipeline, so a bonus step that's out of range must never call
// it: doing so would silently overwrite the primary step's own in-flight destination, every tick,
// forever. An out-of-range bonus step under allowTravel:false simply does nothing this tick.
export function runStep(creep: Creep, step: Step, locked?: Id<_HasId>, allowTravel = true): StepResult {
  switch (step.do) {
    case "harvest":
      // No free-capacity guard here (unlike withdraw/pickup): the engine lets a full miner keep
      // harvesting, dropping the overflow to the ground. A container miner whose CARRY has filled
      // because its container is full must NOT stop mining — its surplus spills onto (or beside) the
      // container for a hauler to collect, and it resumes filling the container the instant space frees.
      // Only an empty source (ERR_NOT_ENOUGH_RESOURCES from harvest) legitimately idles a miner.
      return harvestStep(creep, step.from, locked, allowTravel);
    case "withdraw":
      if (creep.store.getFreeCapacity() === 0) return { acted: false, didAct: false };
      return actOn(
        creep,
        step.from,
        locked,
        t => creep.withdraw(t as Structure & { store: StoreDefinition }, step.resource ?? RESOURCE_ENERGY),
        1,
        allowTravel
      );
    case "pickup":
      if (creep.store.getFreeCapacity() === 0) return { acted: false, didAct: false };
      return actOn(creep, step.from, locked, t => creep.pickup(t as Resource), 1, allowTravel);
    case "gather":
      if (creep.store.getFreeCapacity() === 0) return { acted: false, didAct: false };
      return actOn(
        creep,
        step.from,
        locked,
        t =>
          isResource(t)
            ? creep.pickup(t)
            : creep.withdraw(t as Structure & { store: StoreDefinition }, step.resource ?? RESOURCE_ENERGY),
        1,
        allowTravel
      );
    case "transfer":
      if (creep.store.getUsedCapacity() === 0) return { acted: false, didAct: false };
      return actOn(
        creep,
        step.to,
        locked,
        t => creep.transfer(t as Structure & { store: StoreDefinition }, step.resource ?? RESOURCE_ENERGY),
        1,
        allowTravel
      );
    case "build":
      return actOn(
        creep,
        step.at ?? { find: "constructionSite", prefer: "mostProgress" },
        locked,
        t => creep.build(t as ConstructionSite),
        3,
        allowTravel
      );
    case "repair":
      return actOn(creep, step.at, locked, t => creep.repair(t as Structure), 3, allowTravel);
    case "upgrade":
      return actOn(
        creep,
        { find: "controller" },
        locked,
        t => creep.upgradeController(t as StructureController),
        3,
        allowTravel
      );
    case "moveToRoom":
      return allowTravel ? moveToRoom(creep, step) : { acted: false, didAct: false };
    case "sit":
      if (!allowTravel) return { acted: false, didAct: false };
      creep.travelTo(new RoomPosition(step.pos.x, step.pos.y, creep.room.name));
      return { acted: true, didAct: false };
  }
}

// Moves toward a room, following a precomputed route if present. acted:false on arrival or no destination; acted:true while travelling.
function moveToRoom(creep: Creep, step: { room?: string; to?: "scoutTarget" }): StepResult {
  const dest = step.to === "scoutTarget" ? creep.memory.scoutTarget : step.room;
  if (!dest) return { acted: false, didAct: false }; // nothing to move toward — step is a no-op, advance past it

  if (creep.room.name === dest) {
    // Arrived. Clear a consumed dynamic target and its route so the next assignment starts clean.
    if (step.to === "scoutTarget") {
      creep.memory.scoutTarget = undefined;
      creep.memory.route = undefined;
    }
    return { acted: false, didAct: false };
  }

  // Head for the next room's centre with a small range: Traveler's early-out compares global cross-room range, so a large range would stop the creep short of the border.
  const route = creep.memory.route;
  const nextRoom = route && route.dest === dest ? advanceRoute(route, creep.room.name) : dest;
  creep.travelTo(new RoomPosition(25, 25, nextRoom), { range: 3 });
  return { acted: true, didAct: false };
}

/** Next room along a stored route, advancing the cursor as rooms are entered; clamps to the last room if overrun. Mutates route.index. */
export function advanceRoute(route: { rooms: string[]; index: number }, currentRoom: string): string {
  if (route.rooms[route.index] === currentRoom && route.index < route.rooms.length - 1) {
    route.index++;
  }
  return route.rooms[Math.min(route.index, route.rooms.length - 1)];
}

function actOn(
  creep: Creep,
  spec: TargetSpec,
  locked: Id<_HasId> | undefined,
  action: (t: RoomObject) => number,
  range = 1,
  allowTravel = true
): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false, didAct: false };
  if (creep.pos.inRangeTo(target as { pos: RoomPosition }, range)) {
    action(target);
    return { acted: true, didAct: true, target: (target as unknown as { id: Id<_HasId> }).id };
  }
  // Out of range: a co-fired bonus step must not travel (see runStep's allowTravel doc) — resolving a
  // target it can't reach this tick counts as not having acted at all.
  if (!allowTravel) return { acted: false, didAct: false };
  creep.travelTo(target as { pos: RoomPosition });
  return { acted: true, didAct: false, target: (target as unknown as { id: Id<_HasId> }).id };
}

// A container's tile is a mining spot: harvesting from on top of it drops overflow straight in, no
// transfer step needed. Steer there when it's free; a creep already parked on it (including this one)
// just keeps harvesting in place. If another creep holds the tile, fall back to plain range-1 harvesting
// — the role's own "transfer to container" step moves the carried energy instead.
function harvestStep(
  creep: Creep,
  spec: TargetSpec,
  locked: Id<_HasId> | undefined,
  allowTravel = true
): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false, didAct: false };

  const source = target as Source;
  const container = source.pos
    .findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER })[0] as
    | StructureContainer
    | undefined;

  const standTarget = container && isFreeForCreep(container.pos, creep) ? container.pos : undefined;

  if (creep.pos.inRangeTo(source.pos, 1)) {
    creep.harvest(source);
    // Nudge onto the container tile if not already there; with no (free) container, staying put is correct.
    if (allowTravel && standTarget && !creep.pos.isEqualTo(standTarget)) creep.travelTo(standTarget);
    return { acted: true, didAct: true, target: source.id };
  }
  // Out of range: a co-fired bonus step must not travel (see runStep's allowTravel doc).
  if (!allowTravel) return { acted: false, didAct: false };
  creep.travelTo(standTarget ?? source.pos);
  return { acted: true, didAct: false, target: source.id };
}

// A tile is free for this creep if nothing else is standing there — a creep already on it (this one
// included) never blocks itself from staying put.
function isFreeForCreep(pos: RoomPosition, creep: Creep): boolean {
  const occupant = pos.lookFor(LOOK_CREEPS)[0];
  return !occupant || occupant.id === creep.id;
}

// A dropped resource pile needs creep.pickup(); everything else a "gather" spec can resolve to
// (structure, tombstone, ruin) carries a .store and needs creep.withdraw() instead. Same discriminator
// targets.ts's toKind() uses to classify a dropped pile.
function isResource(obj: RoomObject): obj is Resource {
  return (obj as { resourceType?: ResourceConstant }).resourceType !== undefined;
}
