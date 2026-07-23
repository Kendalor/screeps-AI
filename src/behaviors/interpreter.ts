// nextStep decides step advancement as a pure function, testable without a creep; runStep is the actuator that touches the game API.

import { resolveTarget } from "./targets";
import type { Step, TargetSpec } from "./types";

// Gathering steps fill the store; spending steps drain it. Movement steps complete only on arrival,
// never on store state — their completion is signalled by runStep returning acted:false (arrived),
// which the dispatcher turns into targetGone.
type StepKind = "gather" | "spend" | "move";

const STEP_KIND: Record<Step["do"], StepKind> = {
  harvest: "gather",
  withdraw: "gather",
  pickup: "gather",
  transfer: "spend",
  build: "spend",
  repair: "spend",
  upgrade: "spend",
  // Movement steps never self-complete on store state: an empty scout on a moveToRoom must keep
  // travelling, not be skipped as "already done". Arrival is the only completion, via targetGone.
  moveToRoom: "move",
  sit: "move"
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
  if (kind === "move") return false; // completes only via targetGone (arrival), handled above
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
      return moveToRoom(creep, step);
    case "sit":
      creep.travelTo(new RoomPosition(step.pos.x, step.pos.y, creep.room.name));
      return { acted: true };
  }
}

// Move toward a room, following a precomputed room-route when one is present. Returns acted:false on
// arrival (destination reached, or no destination to go to) so the dispatcher advances past the step;
// acted:true while still travelling. Two destinations: a static `step.room`, or the dynamic
// `memory.scoutTarget` (walked via `memory.route`).
function moveToRoom(creep: Creep, step: { room?: string; to?: "scoutTarget" }): StepResult {
  const dest = step.to === "scoutTarget" ? creep.memory.scoutTarget : step.room;
  if (!dest) return { acted: false }; // nothing to move toward — step is a no-op, advance past it

  if (creep.room.name === dest) {
    // Arrived. Clear a consumed dynamic target and its route so the next assignment starts clean.
    if (step.to === "scoutTarget") {
      creep.memory.scoutTarget = undefined;
      creep.memory.route = undefined;
    }
    return { acted: false };
  }

  // Follow the stored route if it still leads to this destination; otherwise a plain travelTo, which
  // also covers the static-room case and the route-computation-failed fallback.
  const route = creep.memory.route;
  const nextRoom = route && route.dest === dest ? advanceRoute(route, creep.room.name) : dest;
  creep.travelTo(new RoomPosition(25, 25, nextRoom), { range: 20 });
  return { acted: true };
}

/**
 * The next room a creep should head for along a stored route, advancing the route's cursor as rooms
 * are entered. If the creep now stands in the room at `index`, the cursor steps forward; the returned
 * room is the one at the (possibly advanced) cursor, clamped to the last room so a creep that overran
 * still aims at the destination. Mutates `route.index` — the one persisted cursor the mover owns.
 */
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
  if (!target) return { acted: false };
  if (creep.pos.inRangeTo(target as { pos: RoomPosition }, range)) {
    action(target);
  } else {
    creep.travelTo(target as { pos: RoomPosition });
  }
  return { acted: true, target: (target as unknown as { id: Id<_HasId> }).id };
}
