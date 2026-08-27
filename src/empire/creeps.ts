// The creep behaviour runner. Acts directly rather than returning intents for most work, since travelTo
// keeps internal path state — EXCEPT the squad anchor write-back (runSquads), a plain Memory decision with
// no such internal state, which goes through the same Intent/execute.ts pipeline every other operation
// decision uses (see SquadBearingOperation.setSquadAnchor's doc) rather than a bespoke direct write.
// Empire-scoped because it iterates Game.creeps directly, not a snapshot.

import {
  boostPreemption,
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
import { resolveStewardTriangle, runStewardTask } from "../behaviors/stewardTaskRunner";
import { sweepEnRoute } from "../behaviors/sweep";
import { parkNearBunker } from "../behaviors/logisticsRunner";
import { runSupplyTask } from "../behaviors/supplyTaskRunner";
import { runTransportTask } from "../behaviors/transportTaskRunner";
import type { Step } from "../behaviors/types";
import type { Colony } from "../colony";
import { slotTiles } from "../lib/formation";
import { inFormation, planSquadActions, planSquadMove, type ActionIntent, type SquadMovePlan, type SquadState } from "../lib/squad";
import { nearestFittingAnchor, NO_OCCUPANCY, type OccupancySource, type TerrainSource } from "../lib/squadPath";
import type { Intent } from "../intents/types";
import { log } from "../lib/log";
import { wrapFn } from "../lib/profiler";
import type { ColonySnapshot } from "../snapshot/types";

// A squad-bearing operation (ADR 0007): supplies the generic Squad machinery with its formation state,
// travel goal, terrain source, and action content. Duck-typed — runSquads finds any operation exposing
// squadState() and treats it as a squad. squadState returns undefined while assembling (members run their
// own step tables) or when there's no squad to move.
interface SquadBearingOperation {
  squadState(colony: ColonySnapshot): SquadState | undefined;
  squadGoal(colony: ColonySnapshot): { x: number; y: number; room: string } | undefined;
  terrain(colony: ColonySnapshot): TerrainSource;
  // Optional: an operation that hasn't been given occupancy data yet (or doesn't need it) simply omits
  // this — resolveSquads below falls back to NO_OCCUPANCY, the same "nothing occupied" fail-open every
  // OccupancySource consumer already assumes for a room with no entry.
  occupancy?(colony: ColonySnapshot): OccupancySource;
  actionPlanner: (state: SquadState, colony: ColonySnapshot) => Map<Id<Creep>, ActionIntent>;
  // Optional: a squad type that wants a placement PREFERENCE the generic planSquadMove deliberately knows
  // nothing about (e.g. Drain's attacker-faces-threat — operations/drain.ts's attackerBiasedMove) supplies
  // its own wrapper here. Omitted entirely by a squad type with no such preference (e.g. Parade) — runSquads
  // falls back to calling the generic planSquadMove directly.
  planMove?(
    state: SquadState,
    goal: { x: number; y: number; room: string },
    colony: ColonySnapshot,
    terrain: TerrainSource,
    now: number,
    occupancy: OccupancySource
  ): SquadMovePlan;
  // The persisted-anchor write side (see ColonyMemory.drainAnchor/paradeAnchor's doc): called by runSquads
  // whenever this tick's plan.anchor differs from the SquadState it was computed from, returning the
  // Intent(s) that persist the change. Every squad-bearing operation must supply this — the anchor is
  // always a persisted value once a squad exists, never optional the way planMove's placement bias is.
  setSquadAnchor(colony: ColonySnapshot, anchor: { x: number; y: number; room: string }): Intent[];
}

function isSquadBearing(op: unknown): op is SquadBearingOperation {
  return typeof (op as { squadState?: unknown })?.squadState === "function";
}

// One squad ready to run this tick: its resolved state, the goal it's heading toward, its terrain source,
// and its action content — everything runSquads needs, computed ONCE so the membership set (below) and the
// squad pass agree on exactly the same members (ADR 0007's single-source-of-truth rule).
interface ResolvedSquad {
  state: SquadState;
  goal: { x: number; y: number; room: string };
  terrain: TerrainSource;
  occupancy: OccupancySource;
  colony: ColonySnapshot;
  actionPlanner: (state: SquadState, colony: ColonySnapshot) => Map<Id<Creep>, ActionIntent>;
  planMove?: SquadBearingOperation["planMove"];
  setSquadAnchor: SquadBearingOperation["setSquadAnchor"];
}

// Resolve every colony's squad-bearing operations into ready-to-run squads, and collect every squad
// member's creep id into one shared set. The main creep loop skips any id in this set; runSquads iterates
// these same resolved squads — so no creep is ever handled by both passes or neither.
function resolveSquads(colonies: readonly Colony[]): { squads: ResolvedSquad[]; members: Set<Id<Creep>> } {
  const squads: ResolvedSquad[] = [];
  const members = new Set<Id<Creep>>();
  for (const colony of colonies) {
    for (const op of colony.operations) {
      if (!isSquadBearing(op)) continue;
      const state = op.squadState(colony.snapshot);
      if (!state || state.members.length === 0) continue;
      const goal = op.squadGoal(colony.snapshot);
      if (!goal) continue;
      const occupancy = op.occupancy ? op.occupancy(colony.snapshot) : NO_OCCUPANCY;
      squads.push({
        state,
        goal,
        terrain: op.terrain(colony.snapshot),
        occupancy,
        colony: colony.snapshot,
        actionPlanner: op.actionPlanner,
        planMove: op.planMove?.bind(op),
        setSquadAnchor: op.setSquadAnchor.bind(op)
      });
      for (const m of state.members) members.add(m.id);
    }
  }
  return { squads, members };
}

// Every live creep of `role`, grouped by home room — computed once per tick (not once per creep) so a
// pool's targetedBy scan (see transportTaskRunner.ts's own doc: "derive fresh each tick, never cache")
// stays O(creeps) overall rather than O(creeps^2). Shared by Transport and Supply (as of Supply's own
// targetedBy discount, supplyRegister.ts's pickSupplyRequest) — both need the exact same "every OTHER live
// creep of my own role in my own home room" grouping. A colony with none of `role` simply has no entry, so
// dispatchCreep's lookup below just sees an empty list.
function creepsByHomeForRole(role: string): Map<string, Creep[]> {
  const out = new Map<string, Creep[]>();
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.role !== role || creep.spawning) continue;
    const list = out.get(creep.memory.home);
    if (list) list.push(creep);
    else out.set(creep.memory.home, [creep]);
  }
  return out;
}

// Returns the squad anchor write-back intents (see SquadBearingOperation.setSquadAnchor's doc) — the ONE
// piece of this function's work that goes through the Intent/execute.ts pipeline; everything else
// (movement, actions) acts directly on Game objects, per the module header.
//
// `boostLabIdsByHome`: each colony's OWN reserved boost lab ids (ColonyMemory.boostLabIds, written by the
// LabRunner — see colony/index.ts's labs()), keyed by colony room name — the exact per-colony keying
// transportByHome (above) already establishes. A creep spawned by colony A must never be handed colony B's
// lab ids, so this is looked up per creep (via creep.memory.home) inside the loop below, and only the
// resulting plain array — never the whole map — is threaded down into dispatchCreep/runOne/boostPreemption,
// whose own signatures stay exactly as Task B left them (a flat readonly Id<StructureLab>[]).
export const runCreepBehaviors = wrapFn(function runCreepBehaviors(
  colonies: readonly Colony[] = [],
  boostLabIdsByHome: Map<string, readonly Id<StructureLab>[]> = new Map()
): Intent[] {
  // Compute squad membership once, up front — the single source of truth shared between the per-creep
  // skip below and the runSquads pass, so a squadded creep is never run by both or neither (ADR 0007).
  const { squads, members: squadMembers } = resolveSquads(colonies);
  const transportByHome = creepsByHomeForRole("transport");
  const supplyByHome = creepsByHomeForRole("supply");

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.spawning) continue;
    // Squadded this tick: handled by runSquads (below), not the ordinary step table. Membership is
    // per-tick runtime state — the same creep runs its own step table on a tick it isn't squadded (before
    // joining, after dissolution, or while a spawned replacement is still walking in — see Drain.squadState).
    if (squadMembers.has(creep.id)) continue;
    // Isolated per creep: an exception dispatching ONE creep must not stop every other creep still left
    // in this loop from acting that tick — confirmed live (2026-08) a foreign creep with no memory
    // (Invader NPC) reaching roadAvoidance's moverNearby threw and froze the rest of Game.creeps for the
    // tick, since the only guard used to be the one system-level runGuarded("creeps", ...) in kernel/tick.ts.
    try {
      dispatchCreep(creep, transportByHome, supplyByHome, boostLabIdsByHome.get(creep.memory.home) ?? []);
    } catch (e) {
      log.error(`creep ${name} threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }

  return runSquads(squads);
}, "creeps:runCreepBehaviors");

// One creep's behavior for the tick — split out of the loop above so it can be wrapped in its own
// try/catch without duplicating the dispatch logic. `boostLabIds` is the colony's reserved boost lab IDs
// (see boostPreemption's doc, behaviors/interpreter.ts) — the same array passed to every boostable creep;
// a creep with no pending boost order never even looks at it.
function dispatchCreep(
  creep: Creep,
  transportByHome: Map<string, Creep[]>,
  supplyByHome: Map<string, Creep[]>,
  boostLabIds: readonly Id<StructureLab>[]
): void {
  // Diverted before the step-table dispatch per the role's own opt-in (Role.dispatch's doc,
  // behaviors/roles/role.ts) rather than a static step table.
  switch (roleDef(creep.memory.role)?.dispatch) {
    case "logistics": {
      // Doesn't run through runOne's step table, so its flee/boost checks (gated on Role.flee/
      // Role.boostable) never see it — checked here instead, ahead of the diversion, so a hauler running
      // the logistics allocator's own task retreats from an armed hostile (or goes to get boosted) exactly
      // like a step-table hauler would. Flee is checked FIRST — an armed threat always outranks a calm
      // walk to a boost lab, same ordering runOne itself uses below.
      if (fleeThreat(creep)) return;
      if ((roleDef(creep.memory.role)?.boostable?.length ?? 0) > 0 && boostPreemption(creep, boostLabIds)) return;
      // Supply and Transport share dispatch:"logistics" (Role.dispatch's doc) and, as of gh #53, share an
      // executor shape too: both are now driven entirely by their own self-registered LogisticsRequest/
      // SupplyRequest pool (behaviors/transportTaskRunner.ts / behaviors/supplyTaskRunner.ts) — the old
      // graph.ts/allocate.ts/logisticsRunner.ts's runTransport path this replaced is deleted entirely, gh
      // #55. A creep with no live pool to draw from (nothing registered, or no vision of home) simply has
      // nothing assigned this tick; park near the bunker via parkNearBunker (logisticsRunner.ts), which
      // survived the deletion as this fallback's shared implementation.
      if (creep.memory.role === "transport") {
        const siblings = (transportByHome.get(creep.memory.home) ?? []).filter(c => c !== creep);
        runTransportTask(creep, siblings);
      } else {
        const siblings = (supplyByHome.get(creep.memory.home) ?? []).filter(c => c !== creep);
        runSupplyTask(creep, siblings);
      }
      if (!creep.memory.logisticsTask) parkNearBunker(creep);
      return;
    }
    case "steward":
      dispatchSteward(creep);
      return;
    default:
      runOne(creep, boostLabIds);
  }
}

// Steward's cutover (gh #54, ADR 0008): drives the anchor link/storage/terminal triangle through
// stewardTaskRunner.ts's rate-ranked pool (gh #51) instead of stewardBehavior.ts's hand-tuned threshold
// checks, which this replaces outright (see stewardBehavior.ts's deletion in this same commit). Movement
// is NOT part of stewardTaskRunner.ts's scope — that module assumes a creep already parked on the anchor
// tile (its withdraw/transfer legs act at range 1 against structures adjacent to the anchor, same as
// stewardBehavior.ts's own targets) — so getting there is handled here, mirroring stewardBehavior.ts's own
// anchorPos/travelTo logic exactly (see logisticsRunner.ts's parkNearBunker for the same "step off the
// road once settled" pattern, not reused directly since a steward has its own fixed single-tile spot
// rather than a spread-out park radius).
function anchorPos(creep: Creep): RoomPosition | undefined {
  const anchor = typeof Memory !== "undefined" ? Memory.colonies?.[creep.memory.home]?.anchor : undefined;
  return anchor ? new RoomPosition(anchor.x, anchor.y, creep.memory.home) : undefined;
}

// Exported for test/unit/empire/creeps.test.ts — the anchor-travel gate this function owns had its only
// coverage in test/unit/steward.test.ts (stewardBehavior.ts's own tests, deleted alongside it at cutover);
// this keeps that movement-mechanics coverage alive without re-testing stewardTaskRunner.ts's own request/
// route logic, which stays covered by logistics/stewardRegister.test.ts.
export function dispatchSteward(creep: Creep): void {
  const anchor = anchorPos(creep);
  if (!anchor) return; // no anchor recorded yet — nothing to park on, nothing to do

  if (!creep.pos.isEqualTo(anchor)) {
    creep.travelTo(anchor);
    return;
  }

  const triangle = resolveStewardTriangle(creep, anchor);
  runStewardTask(creep, triangle);
}

// The squad pass (ADR 0007): iterate SQUADS (not creeps), compute each squad's shared plan once, and
// dispatch every current member. Movement (planSquadMove) and action (planSquadActions) are computed
// independently; runSquadMember issues both intents unconditionally — no gating, no primary/co-fired
// distinction, no shared per-tick resource to contend over (the whole reason the step table's standStill
// referee is gone). Thin and Game-coupled by design (left untested directly — ADR 0007): it only
// translates already-computed assignments into real move/heal/attack calls.
//
// planSquadMove now returns a SquadMovePlan, not just a move list — its `anchor` field is the squad's
// PERSISTED anchor value (see SquadState's doc, lib/squad.ts) after this tick's plan, which may differ from
// `squad.state.anchor` (advanced by a tight-advance step, or corrected by a reform retarget). Persisting
// that change is the owning operation's job (setSquadAnchor, see SquadBearingOperation) — this module
// doesn't write Memory directly for anything else, so the anchor write goes through the same
// Intent/execute.ts pipeline every other per-tick operation decision already uses.
function runSquads(squads: readonly ResolvedSquad[]): Intent[] {
  const out: Intent[] = [];
  for (const squad of squads) {
    const plan = squad.planMove
      ? squad.planMove(squad.state, squad.goal, squad.colony, squad.terrain, Game.time, squad.occupancy)
      : planSquadMove(squad.state, squad.goal, squad.terrain, Game.time, squad.occupancy);
    const actions = planSquadActions(squad.state, squad.colony, squad.actionPlanner);
    logSquadDecision(squad, plan.moves);
    for (const move of plan.moves) {
      const creep = Game.getObjectById(move.creep);
      if (!creep) continue;
      runSquadMember(creep, move.to, actions.get(move.creep));
    }
    const a = plan.anchor;
    if (a.x !== squad.state.anchor.x || a.y !== squad.state.anchor.y || a.room !== squad.state.anchor.room) {
      out.push(...squad.setSquadAnchor(squad.colony, a));
    }
  }
  return out;
}

// Traces planSquadMove's branch (tight-advance vs. reform, and WHERE it's reforming to) plus the actual
// per-member move intents dispatched this tick — everything needed to see why a squad is or isn't
// converging without re-deriving planSquadMove's own logic by hand off a raw position dump. Re-runs the
// same cheap predicate planSquadMove itself used (inFormation) purely for the log line; never influences
// the plan, which was already computed above.
function logSquadDecision(squad: ResolvedSquad, moves: readonly { creep: Id<Creep>; to: { x: number; y: number; room: string } }[]): void {
  const currentSlots = slotTiles(squad.state.anchor, squad.state.formation);
  const tight = inFormation(squad.state.members, currentSlots);
  let branch: string;
  if (!tight) {
    const fit = nearestFittingAnchor(squad.state.anchor, squad.state.formation, squad.terrain, squad.occupancy, Game.time);
    const currentFits = fit && fit.x === squad.state.anchor.x && fit.y === squad.state.anchor.y && fit.room === squad.state.anchor.room;
    branch = currentFits
      ? "reform@current"
      : fit
        ? `reform@nearestFit(${fit.x},${fit.y},${fit.room})`
        : "reform@current(NO-FIT-FOUND-within-radius)";
  } else {
    branch = "tight-advance-or-hold";
  }
  log.debugRoom(
    squad.colony.name,
    `runSquads: anchor=(${squad.state.anchor.x},${squad.state.anchor.y},${squad.state.anchor.room}) ` +
      `goal=(${squad.goal.x},${squad.goal.y},${squad.goal.room}) tight=${tight} branch=${branch} ` +
      `moves=[${moves
        .map(m => {
          const creep = Game.getObjectById(m.creep);
          return `${creep?.name ?? m.creep}->(${m.to.x},${m.to.y},${m.to.room})`;
        })
        .join(",")}]`
  );
}

// Dispatch one squad member: move toward its assigned tile (unless already there) AND fire its assigned
// action (attack/heal), both in the same tick — Screeps permits a creep to move and act independently, and
// nothing here serializes them (see interpreter.ts's kiting for the same "both fire" prior art).
function runSquadMember(creep: Creep, to: { x: number; y: number; room: string }, action: ActionIntent | undefined): void {
  if (creep.pos.roomName !== to.room || !creep.pos.isEqualTo(to.x, to.y)) {
    creep.travelTo(new RoomPosition(to.x, to.y, to.room));
  }
  if (action) {
    const target = Game.getObjectById(action.target);
    if (target) {
      switch (action.do) {
        case "attack":
          creep.attack(target as Creep | Structure);
          break;
        case "rangedAttack":
          creep.rangedAttack(target as Creep | Structure);
          break;
        case "heal":
          creep.heal(target as Creep);
          break;
        case "dismantle":
          creep.dismantle(target as Structure);
          break;
      }
    }
  }
}

function storeOf(creep: Creep): { free: number; used: number; hits: number; hitsMax: number } {
  return { free: creep.store.getFreeCapacity(), used: creep.store.getUsedCapacity(), hits: creep.hits, hitsMax: creep.hitsMax };
}

// True when the creep already stands in action range (1) of its locked target — it has arrived and
// should work the target, not detour to a bystander pile. No lock, or a dead lock, counts as not there.
function atLockedTarget(creep: Creep, locked: Id<_HasId> | undefined): boolean {
  if (!locked) return false;
  const obj = Game.getObjectById(locked) as { pos?: RoomPosition } | null;
  return !!obj?.pos && creep.pos.inRangeTo(obj.pos, 1);
}

const runOne = wrapFn(function runOne(creep: Creep, boostLabIds: readonly Id<StructureLab>[]): void {
  const def = roleDef(creep.memory.role);
  if (!def || def.steps.length === 0) return;

  // Break off whatever this creep is doing and retreat if an armed hostile has closed within range —
  // checked before the step dispatch below (not woven into an individual step) so it pre-empts every
  // step in the table uniformly, not just moveToRoom's between-room travel.
  if (def.flee && fleeThreat(creep)) return;

  // A role built around one specific part (Role.retreatPart — Defender's RANGED_ATTACK, Attacker's
  // ATTACK) that's been fully stripped by combat damage can no longer do its job at all: pull it out
  // toward a healer (or home, where it then sits until the tower heals it back to full — see
  // retreatIfDisarmed's own doc) instead of running its normal steps for zero return.
  if (def.retreatPart && retreatIfDisarmed(creep, def.retreatPart)) return;

  // Boost pre-emption (gh #75, epic #61) — checked AFTER flee/retreat, not before: an armed hostile closing
  // in or a disarmed retreat both outrank a calm walk to a boost lab, same priority order a human player
  // would want. Placed alongside its two siblings (not ahead of the whole dispatch switch in dispatchCreep)
  // so every one of runOne's pre-emption checks lives in exactly one place, checked in exactly one order.
  if ((def.boostable?.length ?? 0) > 0 && boostPreemption(creep, boostLabIds)) return;

  const task = (creep.memory.task ??= { step: 0 });
  if (task.step >= def.steps.length) task.step = 0; // steps changed under us

  // Skip straight to a step with something to do, rather than wasting a tick on one already complete on arrival.
  let step = firstRunnableStep(def.steps, task.step, storeOf(creep), creep);
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
    const result = runStep(creep, def.steps[step], task.target, true, { doNotBlockRoads: def.doNotBlockRoads });

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

  // Every step in the loop came back with nothing to resolve — truly idle this tick. A mover stuck like
  // this in its home room (e.g. a scout with no scoutTarget — see Scouting.strandedScout's doc) would
  // otherwise freeze wherever it happened to be, which can be a spawn's sole exit tile; loiter near the
  // bunker instead, same as an unassigned transport creep (advanceOrPark/runTransport above).
  log.debugCreep(creep.name, `role=${creep.memory.role} idle — every step had nothing to resolve`);
  if (def.mover && creep.room.name === creep.memory.home) parkNearBunker(creep);
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
