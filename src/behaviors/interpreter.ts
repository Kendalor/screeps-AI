// nextStep decides step advancement as a pure function, testable without a creep; runStep is the actuator that touches the game API.

import { actOnResolved, transferTo, withdrawOrPickup } from "./actions";
import { log } from "../lib/log";
import { wrapFn } from "../lib/profiler";
import { stepOffRoad } from "./roadAvoidance";
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
  dismantle: "move", // store-less — never self-completes on store state, only via targetGone (structure destroyed)
  reserve: "move", // a store-less claimer reserves for life — never self-completes, like a movement step
  claim: "move", // store-less colonizer — never self-completes on store state, only via targetGone (see below)
  renew: "move", // store-less — see renewStep: falls through via acted:false whenever renewal isn't needed/possible
  moveToRoom: "move", // never self-completes on store state — arrival (targetGone) is the only completion
  sit: "move",
  attack: "move" // store-less fighter — never self-completes; ends only via targetGone (hostile gone)
};

// The engine's per-tick action pipelines (docs.screeps.com/simultaneous-actions.html): harvest/build/
// repair/upgrade share one WORK-part pipeline and block each other. Every other method — each CARRY-part
// method (transfer/withdraw/pickup) and movement — is its own independent pipeline: none of them block
// the WORK pipeline or each other. (transfer reads the creep's store as it stood at the start of the
// tick, not energy the same tick's harvest just added.) Two steps from different pipelines may act in
// the same tick; "work" is the one pipeline name shared by more than one step type.
const WORK_PIPELINE = new Set<Step["do"]>(["harvest", "build", "repair", "upgrade", "dismantle"]);

function pipelineOf(step: Step["do"]): string {
  return WORK_PIPELINE.has(step) ? "work" : step; // non-work methods are each their own pipeline
}

/** Whether a step collects into the creep's store (harvest/withdraw/pickup/gather), as opposed to spending or moving. */
export function isGatherStep(step: Step): boolean {
  return STEP_KIND[step.do] === "gather";
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
// doNotBlockRoads: a role opts in (Role.doNotBlockRoads, mirroring Role.sweep) so build/repair/upgrade
// steer off a road tile once in range, rather than parking on it for the whole job and blocking travel.
export interface RunStepOptions {
  doNotBlockRoads?: boolean;
}

export const runStep = wrapFn(function runStep(
  creep: Creep,
  step: Step,
  locked?: Id<_HasId>,
  allowTravel = true,
  opts?: RunStepOptions
): StepResult {
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
      return resolveAndAct(creep, step.from, locked, t => withdrawOrPickup(creep, t, step.resource ?? RESOURCE_ENERGY, allowTravel));
    case "pickup":
      if (creep.store.getFreeCapacity() === 0) return { acted: false, didAct: false };
      return actOn(creep, step.from, locked, t => creep.pickup(t as Resource), 1, allowTravel);
    case "gather":
      if (creep.store.getFreeCapacity() === 0) return { acted: false, didAct: false };
      return resolveAndAct(creep, step.from, locked, t => withdrawOrPickup(creep, t, step.resource ?? RESOURCE_ENERGY, allowTravel));
    case "transfer":
      if (creep.store.getUsedCapacity() === 0) return { acted: false, didAct: false };
      return resolveAndAct(creep, step.to, locked, t => transferTo(creep, t, step.resource ?? RESOURCE_ENERGY, allowTravel));
    case "build":
      return actOn(
        creep,
        step.at ?? { find: "constructionSite", prefer: "mostProgress" },
        locked,
        t => creep.build(t as ConstructionSite),
        3,
        allowTravel,
        opts?.doNotBlockRoads
      );
    case "repair":
      return actOn(creep, step.at, locked, t => creep.repair(t as Structure), 3, allowTravel, opts?.doNotBlockRoads);
    case "dismantle":
      return actOn(creep, step.at, locked, t => creep.dismantle(t as Structure), 1, allowTravel, opts?.doNotBlockRoads);
    case "upgrade":
      return upgradeStep(creep, locked, allowTravel, opts?.doNotBlockRoads);
    case "reserve":
      return reserveStep(creep, locked, allowTravel);
    case "claim":
      return claimStep(creep, locked, allowTravel);
    case "renew":
      return renewStep(creep, step.below, locked, allowTravel);
    case "attack":
      return attackStep(creep, step.from, locked, allowTravel);
    case "moveToRoom":
      return allowTravel ? moveToRoom(creep, step) : { acted: false, didAct: false };
    case "sit":
      if (!allowTravel) return { acted: false, didAct: false };
      creep.travelTo(new RoomPosition(step.pos.x, step.pos.y, creep.room.name));
      return { acted: true, didAct: false };
  }
},
"interpreter:runStep");

// Moves toward a room, following a precomputed route if present. acted:false on arrival or no destination; acted:true while travelling.
function moveToRoom(
  creep: Creep,
  step: {
    room?: string;
    to?: "scoutTarget" | "targetRoom" | "buildTargetRoom" | "repairTargetRoom" | "defendTargetRoom" | "attackTargetRoom";
  }
): StepResult {
  const dest =
    step.to === "scoutTarget"
      ? creep.memory.scoutTarget
      : step.to === "targetRoom"
        ? creep.memory.targetRoom
        : step.to === "buildTargetRoom"
          ? creep.memory.buildTargetRoom
          : step.to === "repairTargetRoom"
            ? creep.memory.repairTargetRoom
            : step.to === "defendTargetRoom"
              ? creep.memory.defendTargetRoom
              : step.to === "attackTargetRoom"
                ? creep.memory.attackTargetRoom
                : step.room;
  if (!dest) return { acted: false, didAct: false }; // nothing to move toward — step is a no-op, advance past it

  if (creep.room.name === dest) {
    // Arrived. Clear a consumed scout target and its route so the next assignment starts clean. A
    // targetRoom (a remote miner's permanent destination), buildTargetRoom (reassigned by Building,
    // not self-clearing), and repairTargetRoom (reassigned by Repairing, same rule) are NOT cleared —
    // the creep keeps working there until told otherwise.
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
  allowTravel = true,
  doNotBlockRoads = false
): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false, didAct: false };
  const result = actOnResolved(creep, target, action, range, allowTravel);
  if (allowTravel && doNotBlockRoads && result.didAct) {
    stepOffRoad(creep, (target as { pos: RoomPosition }).pos, range);
  }
  return result;
}

// Resolves a spec, then hands the concrete target to an actions.ts shim (which does its own
// range-check-then-act-or-travel at range 1) — the "no target" short-circuit stays here since the
// shim only knows what to do once a target already exists.
function resolveAndAct(
  creep: Creep,
  spec: TargetSpec,
  locked: Id<_HasId> | undefined,
  act: (t: RoomObject) => StepResult
): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false, didAct: false };
  return act(target);
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

// Upgrade range is 3, so once inside it the creep keeps upgrading every tick regardless of where it
// stands. But parking at the far edge of range leaves it away from its energy source: the controller
// container (range <=1 of the controller) is the ideal spot — upgrade AND withdraw in place. Steer onto
// that free tile when one exists; otherwise close to range 1 of the controller so the creep bunches up
// against it rather than idling at the range-3 rim. Either move runs alongside the upgrade call (movement
// is a separate pipeline from WORK), so drawing closer never costs an upgrade tick.
const UPGRADE_RANGE = 3;
const CONTROLLER_CONTAINER_RANGE = 1; // range of the controller the controller container sits within

function upgradeStep(creep: Creep, locked: Id<_HasId> | undefined, allowTravel: boolean, doNotBlockRoads = false): StepResult {
  const controller = resolveTarget(creep, { find: "controller" }, locked);
  if (!controller) return { acted: false, didAct: false };
  const controllerPos = (controller as StructureController).pos;

  if (!creep.pos.inRangeTo(controllerPos, UPGRADE_RANGE)) {
    // Out of range: a co-fired bonus step must not travel (see runStep's allowTravel doc).
    if (!allowTravel) return { acted: false, didAct: false };
    creep.travelTo(controllerPos, { range: UPGRADE_RANGE });
    return { acted: true, didAct: false, target: (controller as unknown as { id: Id<_HasId> }).id };
  }

  creep.upgradeController(controller as StructureController);
  if (allowTravel) {
    if (doNotBlockRoads) stepOffRoad(creep, controllerPos, UPGRADE_RANGE);
  }
  return { acted: true, didAct: true, target: (controller as unknown as { id: Id<_HasId> }).id };
}

// A claimer reserves the controller of whatever room it stands in (its targetRoom, reached by the
// preceding moveToRoom step). reserveController is range 1. No drawing-closer nicety — a claimer just
// needs to be adjacent; it holds that spot for life.
function reserveStep(creep: Creep, locked: Id<_HasId> | undefined, allowTravel: boolean): StepResult {
  const controller = resolveTarget(creep, { find: "controller" }, locked);
  if (!controller) return { acted: false, didAct: false };
  const controllerPos = (controller as StructureController).pos;

  if (!creep.pos.inRangeTo(controllerPos, 1)) {
    if (!allowTravel) return { acted: false, didAct: false };
    creep.travelTo(controllerPos, { range: 1 });
    return { acted: true, didAct: false, target: (controller as unknown as { id: Id<_HasId> }).id };
  }

  creep.reserveController(controller as StructureController);
  return { acted: true, didAct: true, target: (controller as unknown as { id: Id<_HasId> }).id };
}

// A colonizer claims the controller of whatever room it stands in (its targetRoom, reached by the
// preceding moveToRoom step). claimController is range 1, same as reserveController. Unlike reserve, this
// is a one-time act — once it succeeds the controller is ours and the snapshot picks the room up as a
// Colony next tick, so nothing here needs to keep re-calling once claimed (it simply has no controller
// target moveToRoom would return it to).
//
// A controller already reserved by another player (BPC or otherwise) rejects claimController outright, so
// attackController it down first: attackController is also range 1 and its own downgrade-per-call scales
// with the creep's CLAIM count, same as claimController's reservation-per-call for a normal Claimer (see
// colonizer.ts's body comment for why 2 CLAIM is worth spawning). Once the reservation reaches 0 the
// controller drops to neutral and the very next call is a normal claimController — no separate "done
// attacking" state to track, just re-check reservation every tick.
//
// Whether this room is safe/legal to claim (GCL room cap, already owned by someone else) is a
// target-selection concern, not this step's — but unlike every other step in this file, claimController
// can be rejected for reasons that never self-resolve (ERR_GCL_NOT_ENOUGH, ERR_INVALID_TARGET — the
// latter also covers a room owned outright by another player, which attackController cannot touch, only
// reservations), so a creep that just no-ops on a failed call would sit at the controller retrying
// forever with nothing ever telling anyone why. didAct only reports true on a genuine claim OK (never on
// an attackController call, successful or not — the job isn't done yet), so oneShot never falsely
// completes the step early. memory.claimError remembers the last claimController code seen, purely so the
// log line below fires once per DISTINCT failure (not once per tick for a creep's whole remaining life) —
// cleared the moment the call stops failing (either it succeeds, or the target/range checks above start
// short-circuiting first), so a stale code can never be misread as a current one.
function claimStep(creep: Creep, locked: Id<_HasId> | undefined, allowTravel: boolean): StepResult {
  const controller = resolveTarget(creep, { find: "controller" }, locked) as StructureController | undefined;
  if (!controller) return { acted: false, didAct: false };
  const controllerPos = controller.pos;

  if (!creep.pos.inRangeTo(controllerPos, 1)) {
    if (!allowTravel) return { acted: false, didAct: false };
    creep.travelTo(controllerPos, { range: 1 });
    return { acted: true, didAct: false, target: (controller as unknown as { id: Id<_HasId> }).id };
  }

  if (controller.reservation) {
    creep.attackController(controller);
    return { acted: true, didAct: false, target: (controller as unknown as { id: Id<_HasId> }).id };
  }

  const result = creep.claimController(controller);
  if (result === OK) {
    creep.memory.claimError = undefined;
    creep.memory.claimOwnedByOther = undefined;
    // Job done: the CLAIM part has no further use once the room is owned, and the target room is
    // spawnless (nowhere nearby to recycleCreep for a partial refund; walking back to the sponsor would
    // cost more in transit ticks than the refund is worth — see the project decision on colonizer
    // recycling). suicide() the same tick so Colony's activeColonizeTargets (colony/index.ts) sees this
    // creep gone as soon as possible, letting Colonize stop requesting for this target once its settlers
    // finish too, rather than the colonizer idling out its full CLAIM lifetime doing nothing.
    creep.suicide();
    return { acted: true, didAct: true, target: (controller as unknown as { id: Id<_HasId> }).id };
  }

  // claimError is purely diagnostic (log once per distinct code) — never read by Colonize's
  // claimFailedPermanently. ERR_INVALID_TARGET in particular is ambiguous in the engine: it covers "not a
  // controller", "already owned by someone" (target.level > 0, genuinely terminal), AND "reserved by
  // someone else" (NOT terminal — exactly what the attackController branch above is chipping away at; a
  // colonizer can die mid-fight and a fresh one resumes against whatever reservation level is left). The
  // reservation check above reads controller.reservation fresh every tick, so claimController is never
  // even called while a reservation is still up in the normal case — but a one-tick race (reservation
  // hits 0 mid-tick, a stale read) can still surface ERR_INVALID_TARGET here while the room is merely
  // contested. claimOwnedByOther is the one signal Colonize trusts for "unwinnable" — set only when the
  // controller is genuinely owned, never for a reservation fight, so a contested-but-winnable target can
  // never get torn down out from under an otherwise-recoverable attempt.
  if (creep.memory.claimError !== result) {
    creep.memory.claimError = result;
    log.error(`colonizer ${creep.name} can't claim ${creep.room.name}: ${result} — will keep retrying`);
  }
  if (controller.owner !== undefined) creep.memory.claimOwnedByOther = true;
  return { acted: true, didAct: false, target: (controller as unknown as { id: Id<_HasId> }).id };
}

// Tops up a creep's ticksToLive at a spawn in its OWN targetRoom (never a room it's merely passing
// through, e.g. the sponsor's — see the project decision on renew scope). renewCreep is called on the
// SPAWN, not the creep, unlike every other step in this file — resolveTarget/actOn assume the creep is
// the actor, so this is hand-rolled the same way claimStep/reserveStep are. `below` (Settler's use:
// 500) is a threshold, not a floor to fill to every tick above it: acted:false whenever ticksToLive is
// already comfortable or the target room has no spawn yet, so the interpreter falls straight through to
// the settler's real work (build/upgrade) instead of parking beside a spawn it doesn't need yet.
function renewStep(creep: Creep, below: number, locked: Id<_HasId> | undefined, allowTravel: boolean): StepResult {
  if (creep.ticksToLive === undefined || creep.ticksToLive >= below) return { acted: false, didAct: false };
  if (creep.room.name !== creep.memory.targetRoom) return { acted: false, didAct: false };

  const spawn = resolveTarget(creep, { find: "structure", type: STRUCTURE_SPAWN }, locked);
  if (!spawn) return { acted: false, didAct: false };
  const spawnPos = (spawn as StructureSpawn).pos;

  if (!creep.pos.inRangeTo(spawnPos, 1)) {
    if (!allowTravel) return { acted: false, didAct: false };
    creep.travelTo(spawnPos, { range: 1 });
    return { acted: true, didAct: false, target: (spawn as unknown as { id: Id<_HasId> }).id };
  }

  const result = (spawn as StructureSpawn).renewCreep(creep);
  return { acted: true, didAct: result === OK, target: (spawn as unknown as { id: Id<_HasId> }).id };
}

const RANGED_ATTACK_RANGE = 3;

// Engages the resolved hostile. A pure-melee body just closes to range 1 and swings. A body with
// RANGED_ATTACK kites: fires whenever in range 3 (rangedAttack has no falloff worth chasing away from —
// full damage anywhere inside 3), and if the hostile has closed past that into range 2 or less, flees
// directly away from it instead of standing still, so a melee invader can never pin it down and trade
// hits at point-blank. Only closes distance when the hostile is still outside range 3.
function attackStep(creep: Creep, spec: TargetSpec, locked: Id<_HasId> | undefined, allowTravel: boolean): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false, didAct: false };
  // A structure target (e.g. an invader core) has no kiting concerns — creep.attack()/rangedAttack()
  // accept Structure just as well as Creep, so it shares this same logic, keyed off the ACTOR's body
  // (unchanged), never the target's.
  const hostile = target as Creep | Structure;
  const ranged = creep.getActiveBodyparts(RANGED_ATTACK) > 0;

  if (!ranged) {
    if (creep.pos.inRangeTo(hostile.pos, 1)) {
      creep.attack(hostile);
      return { acted: true, didAct: true, target: hostile.id };
    }
    if (!allowTravel) return { acted: false, didAct: false };
    creep.travelTo(hostile.pos, { range: 1 });
    return { acted: true, didAct: false, target: hostile.id };
  }

  const inFiringRange = creep.pos.inRangeTo(hostile.pos, RANGED_ATTACK_RANGE);
  if (inFiringRange) creep.rangedAttack(hostile);

  if (allowTravel) {
    if (creep.pos.getRangeTo(hostile.pos) < RANGED_ATTACK_RANGE) {
      // Hostile has closed inside firing range — kite: step directly away from it, still firing this tick.
      creep.travelTo(fleeSpot(creep.pos, hostile.pos), { range: 0 });
    } else if (!inFiringRange) {
      creep.travelTo(hostile.pos, { range: RANGED_ATTACK_RANGE });
    }
  }
  return inFiringRange
    ? { acted: true, didAct: true, target: hostile.id }
    : { acted: true, didAct: false, target: hostile.id };
}

// A tile one step directly away from the threat, mirrored across the fighter's own position — travelTo
// walks toward this point, which walks the fighter backward along the same line the hostile is closing on.
// Pinned against a room edge (x/y already 0 or 49) the naive mirror clamps to the fighter's own tile —
// a no-op destination that leaves it stuck on the border while the hostile keeps closing. When an axis
// is wall-blocked, that axis holds still and the other axis alone carries the flee, sliding along the
// edge instead of freezing against it; only if both axes are simultaneously blocked (a corner, with the
// hostile bearing from outside the room) does the fighter have nowhere left to retreat.
function fleeSpot(from: { x: number; y: number; roomName: string }, threat: { x: number; y: number }): RoomPosition {
  const dx = Math.sign(from.x - threat.x) || 1;
  const dy = Math.sign(from.y - threat.y) || 1;
  const xBlocked = (from.x === 0 && dx < 0) || (from.x === 49 && dx > 0);
  const yBlocked = (from.y === 0 && dy < 0) || (from.y === 49 && dy > 0);
  const x = xBlocked ? from.x : Math.min(49, Math.max(0, from.x + dx));
  const y = yBlocked ? from.y : Math.min(49, Math.max(0, from.y + dy));
  return new RoomPosition(x, y, from.roomName);
}

// Nudge an in-range upgrader toward a better standing tile: the free controller container if there is
// one, else in against the controller itself. No-ops (no re-path) once already well placed. Returns
// whether it actually issued a travelTo this tick, so a caller with a second, lower-priority nudge
// (stepOffRoad) knows whether the creep's single travelTo slot is already spoken for.
// function drawCloserToController(creep: Creep, controllerPos: RoomPosition): boolean {
//   const container = controllerPos
//     .findInRange(FIND_STRUCTURES, CONTROLLER_CONTAINER_RANGE, { filter: s => s.structureType === STRUCTURE_CONTAINER })[0] as
//     | StructureContainer
//     | undefined;
//
//   if (container && isFreeForCreep(container.pos, creep)) {
//     if (creep.pos.isEqualTo(container.pos)) return false;
//     creep.travelTo(container.pos);
//     return true;
//   }
//   // No container to stand on: bunch up against the controller so the pack isn't strung out along range 3.
//   if (!creep.pos.inRangeTo(controllerPos, 1)) {
//     creep.travelTo(controllerPos, { range: 1 });
//     return true;
//   }
//   return false;
// }

// A tile is free for this creep if nothing else is standing there — a creep already on it (this one
// included) never blocks itself from staying put.
function isFreeForCreep(pos: RoomPosition, creep: Creep): boolean {
  const occupant = pos.lookFor(LOOK_CREEPS)[0];
  return !occupant || occupant.id === creep.id;
}

