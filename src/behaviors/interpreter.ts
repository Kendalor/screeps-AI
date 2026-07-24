// nextStep decides step advancement as a pure function, testable without a creep; runStep is the actuator that touches the game API.

import { resolveTarget } from "./targets";
import type { Step, TargetSpec } from "./types";

// Gathering steps fill the store; spending steps drain it; movement steps complete only on arrival (signalled by runStep returning acted:false).
type StepKind = "gather" | "spend" | "move";

const STEP_KIND: Record<Step["do"], StepKind> = {
  harvest: "gather",
  withdraw: "gather",
  pickup: "gather",
  transfer: "spend",
  build: "spend",
  repair: "spend",
  upgrade: "spend",
  moveToRoom: "move", // never self-completes on store state — arrival (targetGone) is the only completion
  sit: "move"
};

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

export function runStep(creep: Creep, step: Step, locked?: Id<_HasId>): StepResult {
  switch (step.do) {
    case "harvest":
      return harvestStep(creep, step.from, locked);
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
      return actOn(
        creep,
        step.at ?? { find: "constructionSite", prefer: "mostProgress" },
        locked,
        t => creep.build(t as ConstructionSite),
        3
      );
    case "repair":
      return actOn(creep, step.at, locked, t => creep.repair(t as Structure), 3);
    case "upgrade":
      return actOn(creep, { find: "controller" }, locked, t => creep.upgradeController(t as StructureController), 3);
    case "moveToRoom":
      return moveToRoom(creep, step);
    case "sit":
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
  range = 1
): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false, didAct: false };
  let didAct = false;
  if (creep.pos.inRangeTo(target as { pos: RoomPosition }, range)) {
    action(target);
    didAct = true;
  } else {
    creep.travelTo(target as { pos: RoomPosition });
  }
  return { acted: true, didAct, target: (target as unknown as { id: Id<_HasId> }).id };
}

// A container's tile is a mining spot: harvesting from on top of it drops overflow straight in, no
// transfer step needed. Steer there when it's free; a creep already parked on it (including this one)
// just keeps harvesting in place. If another creep holds the tile, fall back to plain range-1 harvesting
// — the role's own "transfer to container" step moves the carried energy instead.
function harvestStep(creep: Creep, spec: TargetSpec, locked: Id<_HasId> | undefined): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false, didAct: false };

  const source = target as Source;
  const container = source.pos
    .findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER })[0] as
    | StructureContainer
    | undefined;

  const standTarget = container && isFreeForCreep(container.pos, creep) ? container.pos : undefined;

  let didAct = false;
  if (creep.pos.inRangeTo(source.pos, 1)) {
    creep.harvest(source);
    didAct = true;
    // Nudge onto the container tile if not already there; with no (free) container, staying put is correct.
    if (standTarget && !creep.pos.isEqualTo(standTarget)) creep.travelTo(standTarget);
  } else {
    creep.travelTo(standTarget ?? source.pos);
  }
  return { acted: true, didAct, target: source.id };
}

// A tile is free for this creep if nothing else is standing there — a creep already on it (this one
// included) never blocks itself from staying put.
function isFreeForCreep(pos: RoomPosition, creep: Creep): boolean {
  const occupant = pos.lookFor(LOOK_CREEPS)[0];
  return !occupant || occupant.id === creep.id;
}
