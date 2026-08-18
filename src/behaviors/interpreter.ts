// nextStep decides step advancement as a pure function, testable without a creep; runStep is the actuator that touches the game API.

import { actOnResolved, transferTo, withdrawOrPickup } from "./actions";
import { log } from "../lib/log";
import { HEAL_ASSIST_RANGE, massAttackDamagePerPartAt, RANGED_ATTACK_RANGE } from "../lib/combat";
import { isDangerous } from "../memory/reputation";
import { INVADER_USERNAME } from "../mining/remoteSources";
import { NO_PATH_RETRY_AFTER } from "../lib/remotePath";
import { wrapFn } from "../lib/profiler";
import { roomType } from "../lib/roomName";
import { hasFortifiedInvaderCore } from "./scoutTargets";
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
  attackController: "move", // store-less AttackController creep attacks for life — never self-completes, same as reserve
  renew: "move", // store-less — see renewStep: falls through via acted:false whenever renewal isn't needed/possible
  recycle: "move", // store-less — see recycleStep: falls through via acted:false whenever the threshold isn't met yet
  moveToRoom: "move", // never self-completes on store state — arrival (targetGone) is the only completion
  moveToPos: "move", // same as moveToRoom — completes only via targetGone (never set; see moveToPos's own doc)
  sit: "move",
  attack: "move", // store-less fighter — never self-completes; ends only via targetGone (hostile gone)
  heal: "move", // store-less healer — never self-completes; ends only via targetGone (target gone)
  trample: "move", // store-less — never self-completes; ends only via targetGone (site destroyed by standing on it)
  fleeAndHeal: "move", // store-less — never self-completes on store state; ends only via the when:"healthy" gate
  moveToFlag: "move" // store-less — never self-completes on store state; ends only via the when:"damaged" gate
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
  hits: number;
  hitsMax: number;
  targetGone: boolean; // the locked target no longer resolves
  didAct: boolean; // whether the step's game-API call actually fired this tick, distinct from a target merely resolving; drives oneShot
}

export function nextStep(steps: Step[], s: CreepState): number {
  if (isComplete(steps[s.step], s)) {
    return (s.step + 1) % steps.length;
  }
  return s.step;
}

// A "move"-kind step's memory-backed destination, read the same way moveToRoom/moveToPos themselves
// resolve it — undefined means the step is a standing no-op this tick (e.g. a local miner's moveToRoom
// with no targetRoom set). Pure Memory reads only, no Game.* lookups, so this stays as cheap as the
// store-only checks the rest of firstRunnableStep already does; deliberately NOT reused for arrival
// detection (creep.room.name===dest) or route advancement, which still only happen inside moveToRoom
// itself — this only answers "is there anywhere configured to move toward at all."
function moveStepDestination(step: Step, creep: Creep): unknown {
  if (step.do === "moveToRoom") {
    return step.to === "scoutTarget"
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
  }
  if (step.do === "moveToPos") return creep.memory[step.to];
  return undefined;
}

// A "move"-kind step with a memory-backed destination that's currently unset — moveToRoom/moveToPos are
// no-ops without one (see their own doc), but isComplete alone can never see that ("move" kind never
// self-completes on store state, only via targetGone, which only a real runStep call sets). Without this,
// firstRunnableStep's pre-filter always reports a no-destination moveToRoom as "runnable", forcing
// runOne's retry loop to spend a full runStep call confirming what was knowable from Memory alone.
// Confirmed live (2026-08-13 CPU profiling): every LOCAL miner's step table opens with
// `{ do: "moveToRoom", to: "targetRoom" }`, which never has a destination (only remote miners set
// targetRoom) — so every local miner burned one wasted interpreter:runStep call on this every single
// tick, unconditionally, forever. Scout/paradeMember/settler and any other "move"-kind-first role with a
// sometimes-unset memory field get the same fix for free. `creep` is optional so a caller with no real
// Creep (e.g. a pure step-table test harness) simply skips this extra check rather than crashing —
// falling back to the pre-existing "always runnable" behavior for move-kind steps.
function isStandingNoOp(step: Step, creep: Creep | undefined): boolean {
  return !!creep && (step.do === "moveToRoom" || step.do === "moveToPos") && moveStepDestination(step, creep) === undefined;
}

// Skips a step landed on mid-tick that's already complete (e.g. arriving at "upgrade" right after "transfer" emptied the store).
// targetGone is never set here — that reflects a resolution attempt this step hasn't made yet.
// hits/hitsMax default to "fully healed" (1/1) when the caller has no real creep to read them from (e.g.
// a pure step-table test harness) — same fail-open convention isStandingNoOp's optional creep uses, and
// correct regardless: a role with no when:"damaged"/"healthy" step never reads these fields at all.
export function firstRunnableStep(
  steps: Step[],
  from: number,
  store: { free: number; used: number; hits?: number; hitsMax?: number },
  creep?: Creep
): number {
  for (let i = 0; i < steps.length; i++) {
    const idx = (from + i) % steps.length;
    if (isStandingNoOp(steps[idx], creep)) continue;
    const s: CreepState = { step: idx, free: store.free, used: store.used, hits: store.hits ?? 1, hitsMax: store.hitsMax ?? 1, targetGone: false, didAct: false };
    if (!isComplete(steps[idx], s)) return idx;
  }
  return from;
}

export function isComplete(step: Step, s: CreepState): boolean {
  if (s.targetGone) return true;
  // "empty" steps no-op while the creep still carries anything, so a loaded hauler keeps delivering instead of returning early.
  if (step.when === "empty" && s.used > 0) return true;
  // "damaged" steps no-op once hits has dropped below hitsMax — only runs while at full health.
  if (step.when === "damaged" && s.hits < s.hitsMax) return true;
  // "healthy" steps no-op once hits is back at hitsMax — only runs while damaged.
  if (step.when === "healthy" && s.hits >= s.hitsMax) return true;
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
      return resolveAndAct(creep, step.to, locked, t => transferTo(creep, t, step.resource ?? carriedResource(creep), allowTravel));
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
      return upgradeStep(creep, locked, allowTravel, opts?.doNotBlockRoads, step.urgentBelow);
    case "reserve":
      return reserveStep(creep, locked, allowTravel);
    case "claim":
      return claimStep(creep, locked, allowTravel);
    case "attackController":
      return attackControllerStep(creep, locked, allowTravel);
    case "renew":
      return renewStep(creep, step.below, locked, allowTravel);
    case "recycle":
      return recycleStep(creep, step.aboveEnergyCapacity, locked, allowTravel);
    case "attack":
      return attackStep(creep, step.from, locked, allowTravel);
    case "trample":
      return trampleStep(creep, step.at, locked, allowTravel);
    case "heal":
      return healStep(creep, step.at, locked, allowTravel);
    case "moveToRoom":
      return allowTravel ? moveToRoom(creep, step) : { acted: false, didAct: false };
    case "moveToPos":
      return allowTravel ? moveToPos(creep, step) : { acted: false, didAct: false };
    case "sit":
      if (!allowTravel) return { acted: false, didAct: false };
      creep.travelTo(new RoomPosition(step.pos.x, step.pos.y, creep.room.name));
      return { acted: true, didAct: false };
    case "fleeAndHeal":
      return allowTravel ? fleeAndHealStep(creep) : { acted: false, didAct: false };
    case "moveToFlag":
      return allowTravel ? moveToFlagStep(creep) : { acted: false, didAct: false };
  }
},
"interpreter:runStep");

// How many tiles around a source keeper lair / hostile creep to treat as dangerous. A keeper's lair
// spawns a melee+ranged guardian that patrols its source; 5 clears a ranged attacker's kite range plus
// a couple of tiles of margin. A live hostile creep gets the same radius since its own attack range is
// unknown from scout vision alone (could be a ranged attacker just as easily as a healer).
const DANGER_RADIUS = 5;
const DANGER_COST = 25; // added on top of terrain cost, per tile within DANGER_RADIUS — enough to make a multi-tile detour cheaper than cutting through

// Every source-keeper lair and reputation-flagged-dangerous hostile creep currently visible in `room` —
// the shared danger-source list behind both dangerCostMatrix (path planning) and dangerNearby (live
// per-tick recheck) below, so the two can never disagree about what counts as "dangerous."
function dangerSourcesIn(room: Room): RoomPosition[] {
  return [
    ...room.find(FIND_HOSTILE_CREEPS, { filter: c => isDangerous(c.owner.username) }).map(c => c.pos),
    ...room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_KEEPER_LAIR }).map(s => s.pos)
  ];
}

// Penalizes tiles near source keeper lairs and hostile-owned creeps so an unarmed traveller (a scout)
// detours around them instead of pathing straight through a keeper's kill zone. A friendly/neutral
// player's creep (isDangerous false) is left unpenalized — only reputation-flagged owners and NPC
// keepers count as "danger" here (see memory/reputation.ts). Traveler's roomCallback fires for every room
// PathFinder considers, vision or not — a room with no vision has nothing to penalize, so this is a no-op
// there (the matrix is returned unchanged) rather than a special case.
export function dangerCostMatrix(room: Room | undefined, matrix: CostMatrix): CostMatrix {
  if (!room) return matrix;
  const terrain = room.getTerrain();
  const dangers = dangerSourcesIn(room);
  for (const pos of dangers) {
    for (let x = pos.x - DANGER_RADIUS; x <= pos.x + DANGER_RADIUS; x++) {
      for (let y = pos.y - DANGER_RADIUS; y <= pos.y + DANGER_RADIUS; y++) {
        if (x < 0 || x > 49 || y < 0 || y > 49) continue;
        const current = matrix.get(x, y);
        if (current >= 0xff) continue; // already impassable; leave walls/structures alone
        // A wall tile reads 0 from an untouched matrix (nothing else in the pipeline sets real terrain
        // into it — see addStructuresToMatrix, which only ever writes structures/sites/minerals) — the
        // SAME 0 an ordinary open tile reads before any cost has been added. PathFinder's own docs: "if a
        // non-0 value is found in a room's CostMatrix, that value is used INSTEAD OF the default terrain
        // cost" — so bumping a wall's 0 up to DANGER_COST doesn't add a detour penalty, it overwrites the
        // wall into a cheap PASSABLE tile (25, cheaper than swamp's 50). Confirmed live: a settler's
        // avoidDanger path cut straight through solid terrain next to a keeper lair in W44N14 and got
        // permanently stuck trying to walk into a wall every tick. Terrain wall tiles must be left alone
        // exactly like the current>=0xff structures/creeps guard above already protects the ones the
        // matrix itself marked impassable.
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
        matrix.set(x, y, Math.min(0xfe, current + DANGER_COST));
      }
    }
  }
  return matrix;
}

// Live per-tick counterpart to dangerCostMatrix, passed as Traveler's dangerCheck (see traveler.ts's own
// doc on why the room-entry/stuck-counter repath triggers can't substitute for this). dangerCostMatrix only
// ever sees a danger source's position at the moment a path is COMPUTED; a keeper's guardian patrols after
// that and Traveler otherwise has no reason to discard a path that's still successfully moving the creep
// tick over tick — ranged damage doesn't stop movement, so stuckCount never trips either. This re-derives
// the same danger-source list against the creep's CURRENT position every tick a cached path exists, so a
// guardian that has since wandered within DANGER_RADIUS of the creep gets caught immediately instead of
// only at the next room border.
export function dangerNearby(room: Room, pos: RoomPosition): boolean {
  return dangerSourcesIn(room).some(d => d.roomName === pos.roomName && d.getRangeTo(pos) <= DANGER_RADIUS);
}

// How much a reputation-flagged room's hops are inflated in Traveler's own findRoute (called internally
// for a >2-room hop with no precomputed route — see traveler.ts's findTravelPath). Priced high rather
// than Infinity (the user's call): a detour wins whenever one exists, but a creep with truly no other way
// through still gets a route instead of failing outright. Mirrors DANGER_COST's "expensive, not
// impassable" philosophy for the in-room nudge above, just at route-hop granularity instead of tile cost.
const DANGEROUS_ROOM_HOPS = 50;

// Prices a room high in Traveler's findRoute when its last-scouted owner is reputation-flagged
// hostile/dangerous — steers multi-room travel around occupied territory instead of walking straight
// through it. Origin/destination are never penalized (Traveler's own routeCallback already exempts them
// via the same room-name check at its call site), and an unscouted room (no ScoutInfo yet) has no owner
// on record, so it's never treated as dangerous by this alone. Returns the same neutral cost (1) Traveler's
// own findRoute defaults to for every other room, not undefined — Traveler forwards options.routeCallback's
// result as-is only when it returns something, but here there's always an opinion (dangerous or not).
//
// Also excludes a room this same colony has already confirmed (via moveToRoom's own travelTo failure,
// below) is walled solid at every border reachable from `home` — Infinity rather than DANGEROUS_ROOM_HOPS,
// since unlike a merely-dangerous room there is provably no route through it at all, so nothing is lost by
// never offering it as a transit hop. Does not affect the room's own eligibility as a scout destination
// (see schema.ts's noPathFrom doc) — this callback only prices rooms Traveler considers passing THROUGH.
//
// Also excludes (Infinity) a room proven lethal (schema.ts's ScoutInfo.lethalAt doc, kernel/hostileActions.ts's
// recordLethalRoom write) — confirmed live on shard0: a scout assigned a destination beyond a towered room
// (its only route in) walked straight through the tower fire as a mere DANGEROUS_ROOM_HOPS detour cost and
// died there every single generation, never actually reaching its real destination. A merely-hostile room
// is still worth a detour-cost crossing since the scout usually survives to reach whatever's beyond it; a
// lethal one never does, so routing through is pure loss rather than a discouraged-but-viable option.
//
// Also inflates an unvisioned source-keeper room the same way. A keeper room has no controller, so
// ScoutInfo.owner (controller owner/reserver only, see execute.ts's observeRoom) is never "Source Keeper"
// no matter what — isDangerous(info?.owner) alone can never catch one. This mirrors the SK check
// Traveler's own findRoute has built in (traveler.ts's findRoute, gated the same way on !Game.rooms[roomName]
// — "SK rooms are avoided when there is no vision in the room, harvested-from SK rooms are allowed") —
// that check never runs here because this callback already returns a defined number for every room,
// which short-circuits Traveler's own routeCallback before it reaches its SK branch. Confirmed live: a
// remote hauler/miner routed straight through source-keeper rooms W44N15/W44N16 instead of the built,
// vision-held road route through W42N15/W42N16, since both looked like equally cheap cost-1 hops to
// findRoute. Live vision (a miner/guard actually stationed in the room) is trusted the same way Traveler's
// own check trusts it — once vision confirms exactly where the lairs/guardians are, dangerCostMatrix
// prices the room precisely tile-by-tile instead, so this stops adding a redundant blanket detour cost
// on top for a room the colony already actively holds.
// `destination`: the room actually being travelled TO, exempt from every Infinity/detour penalty below —
// a defend/attack/drain/colonize target was chosen ON PURPOSE, often precisely BECAUSE it's dangerous
// (that's what "defend" or "attack" means), so pricing it unreachable here would make the destination
// provably unroutable by construction. Traveler's own findRoute (traveler.ts) calls options.routeCallback
// unconditionally for every room including origin/destination before its own exemption logic ever runs
// (see its `roomName !== destination && roomName !== origin` checks further down, which never fire once
// routeCallback has already returned a defined value) — so this callback must exempt the destination
// itself, the caller-side comments claiming this used to be wrong (confirmed live: a "defend:W48N14" flag
// failed with "couldn't findRoute to W48N14" because W48N14 itself had a live lethalAt from a scout that
// died there earlier — exactly the room the flag exists to send a defender INTO).
export function dangerRouteCallback(home: string, roomName: string, destination?: string): number {
  if (roomName === destination) return 1;
  const info = Memory.rooms?.[roomName]?.scouted;
  const noPathAt = info?.noPathFrom?.[home];
  if (noPathAt !== undefined && Game.time - noPathAt < NO_PATH_RETRY_AFTER) return Infinity;
  if (info?.lethalAt !== undefined && Game.time - info.lethalAt < NO_PATH_RETRY_AFTER) return Infinity;
  // A Stronghold's fortified core (see schema.ts's ScoutInfo.invaderCore doc) is just as much a pure-loss
  // transit hop as a proven-lethal room — same reasoning as the lethalAt check above, see
  // hasFortifiedInvaderCore's doc for why a level-0 core doesn't trigger this.
  if (hasFortifiedInvaderCore(info, Game.time)) return Infinity;
  if (isDangerous(info?.owner)) return DANGEROUS_ROOM_HOPS;
  if (roomType(roomName) === "keeper" && !Game.rooms[roomName]) return DANGEROUS_ROOM_HOPS;
  return 1;
}

// The same danger-avoidance bundle moveToRoom passes to Traveler below (useFindRoute/roomCallback/
// routeCallback/dangerCheck), factored out so any OTHER cross-room travelTo call — transport.ts's
// logistics executor in particular, which has no step-table moveToRoom step of its own and previously
// called creep.travelTo with no danger awareness at all — can opt into identical keeper/hostile-avoidance
// routing rather than reimplementing or subtly diverging from it. See dangerCostMatrix/dangerRouteCallback/
// dangerNearby's own docs for what each piece actually does; this is purely the wiring, not new behavior.
// `destination` is optional (transport.ts's callers don't always know one up front) but should be passed
// whenever the caller has a real target room — see dangerRouteCallback's own doc for why it matters.
export function dangerAvoidanceOptions(home: string, destination?: string): TravelToOptions {
  return {
    useFindRoute: true,
    roomCallback: (roomName, matrix) => dangerCostMatrix(Game.rooms[roomName], matrix),
    routeCallback: (roomName: string) => dangerRouteCallback(home, roomName, destination),
    dangerCheck: dangerNearby
  };
}

// Moves toward a room, following a precomputed route if present. acted:false on arrival or no destination; acted:true while travelling.
function moveToRoom(
  creep: Creep,
  step: {
    room?: string;
    to?: "scoutTarget" | "targetRoom" | "buildTargetRoom" | "repairTargetRoom" | "defendTargetRoom" | "attackTargetRoom";
    avoidDanger?: boolean;
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

  // Arrived means standing IN dest and clear of its border tiles (x/y 0 or 49) — not merely having crossed
  // into it. A creep sitting exactly on an edge tile that doesn't explicitly move this tick gets nudged
  // back into the room it came from by the engine itself; reporting "arrived" there (and so never calling
  // travelTo again) left the creep bounce across the border forever, one room in, one room back, every
  // tick (confirmed live: a drain squad member oscillating W6N3(49,26)->W5N3(0,26)->W6N3(49,26)...). Still
  // walking travelTo toward the room centre while on the edge (the branch below) draws it in one more step,
  // same as any other not-yet-arrived tile. Checked only once room.name===dest is already known, so a
  // creep still elsewhere never needs a real pos.x/y (some callers stub a bare {room, memory, travelTo}).
  const arrived = creep.room.name === dest && creep.pos.x !== 0 && creep.pos.x !== 49 && creep.pos.y !== 0 && creep.pos.y !== 49;
  if (arrived) {
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
  const result = creep.travelTo(new RoomPosition(25, 25, nextRoom), {
    range: 3,
    // Forced rather than left to Traveler's own roomDistance>2 heuristic: that heuristic is recomputed
    // fresh from the creep's CURRENT position on every call, so it silently drops to a blind
    // PathFinder.search (no routeCallback at all) once the remaining hop count looks short enough — which
    // happens precisely when a multi-room trip is passing near/through the room avoidDanger exists to
    // route around. Confirmed live on shard0: a scout travelling E28S4->...->E27S2 past hostile-owned
    // E28S2 got real danger-routing while far away, then flipped to blind mode after crossing into E28S3
    // (linear distance to E27S2 dropped to 2), and the resulting blind search cut straight back through
    // E28S2 — forcing another blind repath from inside it that reversed again, oscillating forever.
    // avoidDanger steps always cross multiple rooms by construction (a same-room step never reaches
    // here — see the arrival check above), so there's no case where forcing this trades away anything.
    ...(step.avoidDanger ? dangerAvoidanceOptions(creep.memory.home, dest) : {})
  });
  // A scout genuinely can't path into nextRoom from here (Traveler's own PathFinder search, with real
  // vision at this border, came back empty) — e.g. the shared border is walled solid by another player.
  // Game.map.findRoute/scoutCandidatesAround can't detect this at all (they don't see constructed walls),
  // so this is the only place the failure is ever observed. Cached on the DESTINATION room's ScoutInfo so
  // dangerRouteCost can stop pricing it as a viable transit hop for other routes; the room stays a valid
  // scouting candidate regardless (see schema.ts's noPathFrom doc) — the scout can still always reach the
  // exit tile itself and observe the room from there.
  // The destination may never have been scouted yet (no ScoutInfo on record at all) — the exact case that
  // makes this failure worth caching in the first place, since a still-unscouted room is the one every
  // frontier pick keeps re-offering. A bare `if (info)` guard here would silently drop the write for
  // precisely that case, leaving the scout to repeat the same failing travelTo forever (confirmed live on
  // shard0: a scout parked at a solid-walled border, destination never yet visited, retried every tick
  // until it died of old age). So a never-seen stub (tick left absent, same as observeRoom's convention)
  // is created on demand rather than requiring one to already exist.
  if (step.to === "scoutTarget" && result === ERR_NO_PATH) {
    const rooms = (Memory.rooms ??= {});
    const roomMem = (rooms[nextRoom] ??= {});
    const info = (roomMem.scouted ??= { type: roomType(nextRoom), sources: [], hostile: false });
    (info.noPathFrom ??= {})[creep.memory.home] = Game.time;
  }
  return { acted: true, didAct: false };
}

// Shared advance leg for every flag-following role (SimpleBaitTowerRole, DemolisherRole,
// SimpleHealerRole — see the Step union's doc): walks toward creep.memory.followFlag's CURRENT position,
// read straight from Game.flags every tick — dragging the flag in the client redirects the creep on its
// very next move. Falls back to plain moveToRoom(targetRoom) behavior whenever followFlag is unset or
// the named flag no longer exists (removed, or a creep spawned before this field existed), so a missing
// flag never strands the creep — it still has somewhere to walk. Never self-completes on arrival; the
// caller's when:"damaged" gate is what ends this step once the creep takes a hit.
function moveToFlagStep(creep: Creep): StepResult {
  const flag = creep.memory.followFlag ? Game.flags[creep.memory.followFlag] : undefined;
  if (!flag) return moveToRoom(creep, { to: "targetRoom" });

  if (creep.pos.isEqualTo(flag.pos)) return { acted: false, didAct: false };
  creep.travelTo(flag.pos, { range: 1 });

  // attack/heal share one pipeline (docs.screeps.com/simultaneous-actions.html) — only the last call
  // made actually fires, so these must be mutually exclusive, in priority order, not all unconditional.
  if (creep.hits < creep.hitsMax) {
    creep.heal(creep);
    return { acted: true, didAct: false };
  }
  if (creep.pos.roomName == flag.pos.roomName) {
    const structures = creep.pos.findInRange(FIND_STRUCTURES, 1);
    if (structures.length > 0) {
      structures.sort((a, b) => (a.structureType === STRUCTURE_SPAWN ? 0 : 1) - (b.structureType === STRUCTURE_SPAWN ? 0 : 1));
      creep.attack(structures[0]);
      return { acted: true, didAct: false };
    }
    const creeps = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1);
    if (creeps.length > 0) {
      creep.attack(creeps[0]);
      return { acted: true, didAct: false };
    }
  }

  return { acted: true, didAct: false };
}

// SimpleBaitTowerRole's retreat leg (see the Step union's doc): still standing in creep.memory.targetRoom
// — the hostile room — path toward a REACHABLE exit tile of the CURRENT room (running for the border by
// the shortest actually-walkable route, not toward any specific neighboring room); already outside
// targetRoom — step one tile further off that exit tile toward the room's centre, so it isn't left parked
// in the doorway. Self-heals every tick either way (creep.heal is a no-op above hitsMax, so this is safe
// to call unconditionally). A no-op (falls through, same as moveToRoom with no dest) while targetRoom is
// unset. Store-less, never self-completes here — only the when:"healthy" gate on this step ends it.
//
// FIND_EXIT returns every border tile in all 4 directions, including ones that are TERRAIN_MASK_WALL —
// a room's border can be walled right up to the edge, same as any interior tile — and even an open exit
// tile can be sealed off from the creep's actual position by hostile walls/ramparts elsewhere in the room.
// findClosestByRange only ever looks at raw Chebyshev distance, with no walkability or reachability
// awareness at all, so it can hand back a destination the creep can never actually path to. Confirmed
// live twice in the same hostile room (W48N13): simpleBaitTower_W47N14_73031758 got sent at a solid wall
// tile; simpleBaitTower_W47N14_73066777 got sent at an open-terrain exit it couldn't reach because a wall
// cluster blocked every route to it, and starved there instead of retreating. PathFinder.search against
// every exit tile at once (using fleeCostMatrix's same wall/obstacle/hostile-rampart pricing as the
// danger-flee path) picks whichever exit is actually reachable, or reports no path at all instead of
// aiming at a dead end.
function nearestReachableExit(creep: Creep): RoomPosition | undefined {
  const terrain = creep.room.getTerrain();
  const exits = creep.room.find(FIND_EXIT).filter(pos => terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL);
  if (exits.length === 0) return undefined;
  const result = PathFinder.search(
    creep.pos,
    exits.map(pos => ({ pos, range: 0 })),
    { maxRooms: 1, roomCallback: fleeCostMatrix }
  );
  if (result.incomplete || result.path.length === 0) return undefined;
  return result.path[result.path.length - 1];
}

// Live target room for the flag-following family (see moveToFlagStep's own doc): a followFlag's CURRENT
// room, read straight from Game.flags every tick same as moveToFlagStep's own position read, so dragging
// the flag across a border updates retreat/re-entry behavior on the very same tick the creep's advance
// leg starts following it there too — the two legs never disagree about which room is "home turf" for a
// dragged flag the way a frozen creep.memory.targetRoom snapshot would. Falls back to targetRoom whenever
// followFlag is unset or the named flag no longer exists, same fallback moveToFlagStep uses.
function liveTargetRoom(creep: Creep): string | undefined {
  const flag = creep.memory.followFlag ? Game.flags[creep.memory.followFlag] : undefined;
  return flag ? flag.pos.roomName : creep.memory.targetRoom;
}

function fleeAndHealStep(creep: Creep): StepResult {
  const targetRoom = liveTargetRoom(creep);
  if (!targetRoom) return { acted: false, didAct: false };

  creep.heal(creep);
  if (creep.room.name === targetRoom) {
    const exit = nearestReachableExit(creep);
    if (exit) creep.travelTo(exit, { range: 0 });
  } else if (creep.pos.x === 0 || creep.pos.x === 49 || creep.pos.y === 0 || creep.pos.y === 49) {
    creep.travelTo(new RoomPosition(25, 25, creep.room.name), { range: 20 });
  }
  return { acted: true, didAct: false };
}

// Moves toward a concrete TILE read from a memory field (drainRallyPos or paradeRallyPos — see the Step
// union's doc), refreshed every tick by the owning operation. Unlike moveToRoom, "arrived" is never
// declared here at all: the destination is a live point that can itself be moving (a squad's anchor
// tracking its own advance), so there is nothing to latch as "reached" the way a static room name has.
// The step simply keeps calling travelTo every tick it runs; the NEXT step (attack/heal) takes over once
// the creep is within ITS OWN range of ITS OWN target, exactly like moveToRoom's relationship to the step
// that follows it today. A no-op (falls through) when the field is unset, mirroring moveToRoom's
// no-destination case — a role between assembly and dissolution simply has nothing to rally toward.
function moveToPos(creep: Creep, step: { to: "drainRallyPos" | "paradeRallyPos" }): StepResult {
  const dest = creep.memory[step.to];
  if (!dest) return { acted: false, didAct: false };
  creep.travelTo(new RoomPosition(dest.x, dest.y, dest.room), { range: 1 });
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

// A transfer step with no explicit `resource` defaults to whatever the creep is actually carrying, energy
// first (the overwhelming common case, and every existing role's steps carry only energy so this is a
// no-op for them) — lets a mineralMiner's static step table (built with no per-room mineral type known)
// transfer whichever mineral it just harvested without hardcoding a type.
function carriedResource(creep: Creep): ResourceConstant {
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) return RESOURCE_ENERGY;
  const held = Object.keys(creep.store) as ResourceConstant[];
  return held[0] ?? RESOURCE_ENERGY;
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

function upgradeStep(
  creep: Creep,
  locked: Id<_HasId> | undefined,
  allowTravel: boolean,
  doNotBlockRoads = false,
  urgentBelow?: number
): StepResult {
  const controller = resolveTarget(creep, { find: "controller" }, locked);
  if (!controller) return { acted: false, didAct: false };
  const ticksToDowngrade = (controller as StructureController).ticksToDowngrade;
  if (urgentBelow !== undefined && ticksToDowngrade >= urgentBelow) return { acted: false, didAct: false };
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
//
// A controller left reserved by a STRUCTURE_INVADER_CORE (username "Invader") is attackController'd down
// instead of reserveController'd: reserveController against the Invader's reservation would work (see
// operations/reservation.ts's header), but attackController strips it in one shot per call regardless of
// the claimer's CLAIM count, where reserveController only nets the difference between CLAIM count and the
// reservation's own per-tick decay — the same slow-drain problem the claimer's 2-CLAIM floor exists to
// avoid (see claimer.ts's body comment). Once the Invader's reservation hits 0 the controller is neutral
// again and the very next call is a normal reserveController — no separate "done attacking" state to
// track, just re-check reservation.username every tick, same pattern as claimStep.
function reserveStep(creep: Creep, locked: Id<_HasId> | undefined, allowTravel: boolean): StepResult {
  const controller = resolveTarget(creep, { find: "controller" }, locked) as StructureController | undefined;
  if (!controller) return { acted: false, didAct: false };
  const controllerPos = controller.pos;

  if (!creep.pos.inRangeTo(controllerPos, 1)) {
    if (!allowTravel) return { acted: false, didAct: false };
    creep.travelTo(controllerPos, { range: 1 });
    return { acted: true, didAct: false, target: (controller as unknown as { id: Id<_HasId> }).id };
  }

  if (controller.reservation?.username === INVADER_USERNAME) {
    creep.attackController(controller);
    return { acted: true, didAct: false, target: (controller as unknown as { id: Id<_HasId> }).id };
  }

  creep.reserveController(controller);
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

// An AttackController creep's whole job: walk to whatever room it's sent at (its targetRoom/followFlag,
// reached by the preceding moveToFlag step) and attackController the controller there, every tick, for
// life — never reserveController or claimController like Claimer/Colonizer. attackController is range 1,
// same as reserveController/claimController, and needs no OK/target-gone bookkeeping the way
// claimStep does: there's no terminal "done" state to reach (an owned controller's downgrade timer or
// another player's reservation both just keep ticking back up the moment this creep dies), so the step
// simply keeps calling every tick it's in range, identical in shape to reserveStep's own steady-state
// call but never falling through to reserveController first.
function attackControllerStep(creep: Creep, locked: Id<_HasId> | undefined, allowTravel: boolean): StepResult {
  const controller = resolveTarget(creep, { find: "controller" }, locked) as StructureController | undefined;
  if (!controller) return { acted: false, didAct: false };
  const controllerPos = controller.pos;

  if (!creep.pos.inRangeTo(controllerPos, 1)) {
    if (!allowTravel) return { acted: false, didAct: false };
    creep.travelTo(controllerPos, { range: 1 });
    return { acted: true, didAct: false, target: (controller as unknown as { id: Id<_HasId> }).id };
  }

  creep.attackController(controller);
  return { acted: true, didAct: true, target: (controller as unknown as { id: Id<_HasId> }).id };
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

// Walks to a spawn in the creep's OWN targetRoom (never a room it's merely passing through, e.g. the
// sponsor's — same scoping as renewStep, and for the same reason: a settler spawns in the sponsor's
// room, which already has a well-developed energyCapacityAvailable, so without this gate it would read
// the SPONSOR's capacity and recycle itself at the sponsor's spawn before ever traveling to the actually-
// nascent target room) and recycles the creep there, but only once that room's energyCapacityAvailable
// has reached `aboveEnergyCapacity` — below that threshold, or while the room has no spawn yet, this is a
// no-op fall-through to the rest of the step table (same "act or fall through" shape as renewStep).
// Unlike renew this is meant to hold the creep in place once it starts: once the threshold is reached
// there's nothing else useful left to do, so a caller ordering this step early is expected. recycleCreep
// is called on the SPAWN, not the creep, same hand-rolled pattern as renewStep/claimStep/reserveStep.
function recycleStep(creep: Creep, aboveEnergyCapacity: number, locked: Id<_HasId> | undefined, allowTravel: boolean): StepResult {
  if (creep.room.name !== creep.memory.targetRoom) return { acted: false, didAct: false };
  if (creep.room.energyCapacityAvailable < aboveEnergyCapacity) return { acted: false, didAct: false };

  const spawn = resolveTarget(creep, { find: "structure", type: STRUCTURE_SPAWN }, locked);
  if (!spawn) return { acted: false, didAct: false };
  const spawnPos = (spawn as StructureSpawn).pos;

  if (!creep.pos.inRangeTo(spawnPos, 1)) {
    if (!allowTravel) return { acted: false, didAct: false };
    creep.travelTo(spawnPos, { range: 1 });
    return { acted: true, didAct: false, target: (spawn as unknown as { id: Id<_HasId> }).id };
  }

  const result = (spawn as StructureSpawn).recycleCreep(creep);
  return { acted: true, didAct: result === OK, target: (spawn as unknown as { id: Id<_HasId> }).id };
}

// All hostile creeps in the room within range of the fighter, closest lookup shared by the melee-threat
// check and the mass-attack damage total below — both read off room.find (like every other target
// lookup in this file, see targets.ts's findCandidates) rather than a position-scoped API, so both stay
// exercisable against the same hostile fixtures as the rest of this file's tests.
function hostilesWithin(creep: Creep, range: number): Creep[] {
  return creep.room
    .find(FIND_HOSTILE_CREEPS)
    .filter(h => creep.pos.getRangeTo(h.pos) <= range);
}

// True if any hostile creep within the defender's own engagement zone (range 3 — the same radius it
// fires and closes within) carries an ATTACK part. Checked against ALL nearby hostiles, not just the
// resolved target: an armed hostile sitting at range 3 is exactly the case that must still hold at
// range 3 rather than close in, and a defender must not wander into a second attacker's melee range
// while it kites or closes on a different, unarmed one.
function nearbyMeleeThreat(creep: Creep): boolean {
  return hostilesWithin(creep, RANGED_ATTACK_RANGE).some(h => h.getActiveBodyparts(ATTACK) > 0);
}

// Total rangedMassAttack damage the creep would deal this tick from its CURRENT position, summed
// across every hostile in range 3 with the range-3/2/1 falloff, scaled by how many RANGED_ATTACK parts
// the creep carries (each part hits every target in range independently, same as rangedAttack).
// Mirrors the engine's own per-target loop rather than assuming a single cluster distance.
function massAttackDamage(creep: Creep, rangedParts: number): number {
  let total = 0;
  for (const h of hostilesWithin(creep, RANGED_ATTACK_RANGE)) {
    total += massAttackDamagePerPartAt(creep.pos.getRangeTo(h.pos)) * rangedParts;
  }
  return total;
}

// Engages the resolved hostile. A pure-melee body just closes to range 1 and swings. A body with
// RANGED_ATTACK fires whenever in range 3 (rangedAttack has no falloff worth chasing away from — full
// damage anywhere inside 3) and picks rangedAttack vs rangedMassAttack by whichever deals more total
// damage this tick (mass attack only wins with enough hostiles clustered close, since its single-target
// falloff is steep). Movement only kites away from a body with no ATTACK part on it or on any other
// hostile nearby (see nearbyMeleeThreat) — a genuinely unarmed cluster (scouts, healers, claimers) is
// free to be closed on and mass-attacked instead of fled from. Once any nearby hostile does carry
// ATTACK, the creep still flees rather than trade hits at point-blank, same as before.
function attackStep(creep: Creep, spec: TargetSpec, locked: Id<_HasId> | undefined, allowTravel: boolean): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false, didAct: false };
  // A structure target (e.g. an invader core) has no kiting concerns — creep.attack()/rangedAttack()
  // accept Structure just as well as Creep, so it shares this same logic, keyed off the ACTOR's body
  // (unchanged), never the target's.
  const hostile = target as Creep | Structure;

  // Every branch below (kiting, closing in, approaching firing range) assumes hostile.pos is a point
  // INSIDE creep.room — true for a freshly-resolved find:"hostile" target (targets.ts's findCandidates
  // only searches creep.room), but not for a locked target: validLock re-checks a "hostile" lock purely
  // via Game.getObjectById, with no same-room requirement, so a lock taken while fighting in one room
  // survives the creep being pushed/retreating back into another. clampInterior(hostile.pos,
  // creep.room.name) then silently reinterprets the hostile's foreign-room x/y as coordinates in the
  // creep's OWN room, and maxRooms:1 confines the search there — producing a real but meaningless
  // in-room destination instead of a failed/cross-room path. Confirmed live: a defender locked onto an
  // invader in a different room crept toward clampInterior's bogus same-room point for hundreds of
  // ticks. A plain, uncapped travelTo is the correct behavior once the target is provably elsewhere —
  // none of the in-room bait/border tactics below apply to a hop that must cross a border anyway.
  if (hostile.pos.roomName !== creep.room.name) {
    if (creep.pos.inRangeTo(hostile.pos, 1)) {
      creep.attack(hostile);
      return { acted: true, didAct: true, target: hostile.id };
    }
    if (!allowTravel) return { acted: false, didAct: false };
    creep.travelTo(hostile.pos, { range: creep.getActiveBodyparts(RANGED_ATTACK) > 0 ? RANGED_ATTACK_RANGE : 1 });
    return { acted: true, didAct: false, target: hostile.id };
  }

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

  const rangedParts = creep.getActiveBodyparts(RANGED_ATTACK);
  const inFiringRange = creep.pos.inRangeTo(hostile.pos, RANGED_ATTACK_RANGE);
  const meleeThreatened = nearbyMeleeThreat(creep);

  if (inFiringRange) {
    const single = RANGED_ATTACK_POWER * rangedParts;
    const mass = massAttackDamage(creep, rangedParts);
    if (mass > single) creep.rangedMassAttack();
    else creep.rangedAttack(hostile);
    log.debugCreep(creep.name, `attackStep: firing at ${hostile.id} (mass=${mass.toFixed(0)} single=${single})`);
  }

  if (allowTravel) {
    const range = creep.pos.getRangeTo(hostile.pos);
    if (meleeThreatened && range < RANGED_ATTACK_RANGE) {
      // A melee-capable hostile is close enough to threaten next tick — kite: step directly away,
      // still firing this tick. maxRooms:1 belt-and-suspenders fleeSpot's own room-interior clamp: even
      // if the flee tile ever ended up choosable via a neighboring room's edge, Traveler must never
      // route the escape through a border crossing — a defender that flees INTO an unscouted, possibly
      // hostile-held room is worse off than one that holds and traded a hit.
      log.debugCreep(creep.name, `attackStep: kiting away from ${hostile.id} (range=${range}, melee threat nearby)`);
      creep.travelTo(fleeSpot(creep.pos, hostile.pos), { range: 0, maxRooms: 1 });
    } else if (!meleeThreatened && range > 1) {
      // Nothing nearby can punish point-blank range — close in freely for a better mass-attack angle
      // (and to keep pace with a fleeing unarmed target) instead of holding at range 3. maxRooms:1 stops
      // a hostile camped near the border from baiting the chase across it: the target always resolves
      // from THIS room (see targets.ts's find:"hostile" — room.find never sees a neighboring room's
      // creeps), so "range 1 of it" is always satisfiable without leaving, and pinning the search to one
      // room forces Traveler to find that in-room approach instead of a shorter path through the exit.
      // clampInterior on the DESTINATION too — an unarmed hostile camped on or beside the exit tile is
      // itself a bait: closing to literal range 1 of it would park the defender on the border. Chasing
      // the clamped-inward stand-in instead still narrows the gap without ever stepping onto the exit.
      log.debugCreep(creep.name, `attackStep: closing in on unarmed ${hostile.id} (range=${range})`);
      creep.travelTo(clampInterior(hostile.pos, creep.pos.roomName), { range: 1, maxRooms: 1 });
    } else if (!inFiringRange) {
      log.debugCreep(creep.name, `attackStep: moving into firing range of ${hostile.id} (range=${range})`);
      creep.travelTo(hostile.pos, { range: RANGED_ATTACK_RANGE, maxRooms: 1 });
    } else {
      log.debugCreep(creep.name, `attackStep: holding position at range=${range} (melee threat=${meleeThreatened})`);
    }
  }
  return inFiringRange
    ? { acted: true, didAct: true, target: hostile.id }
    : { acted: true, didAct: false, target: hostile.id };
}

// Walks onto a hostile construction site's own tile — the engine destroys the site the instant any
// creep (ours or otherwise) occupies it, no attack()-style call involved. So "acting" here is nothing
// more than closing to range 0: didAct only turns true once actually standing on the tile, which is
// also the tick the site vanishes (targetGone then ends the step, same as attackStep ending on a dead
// hostile). No range-3/kiting logic — there's nothing to be threatened by beyond what attackStep already
// guards elsewhere in the same step table, and a site itself can never fight back.
function trampleStep(creep: Creep, spec: TargetSpec, locked: Id<_HasId> | undefined, allowTravel: boolean): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false, didAct: false };
  const site = target as ConstructionSite;
  if (creep.pos.isEqualTo(site.pos)) {
    return { acted: true, didAct: true, target: site.id };
  }
  if (!allowTravel) return { acted: false, didAct: false };
  creep.travelTo(site.pos, { range: 0 });
  return { acted: true, didAct: false, target: site.id };
}

// Heals the resolved target (a squad-mate, including possibly self — see targets.ts's find:"squadMate").
// creep.heal() at range 1 for full HEAL_POWER; creep.rangedHeal() at range 2-3 for reduced
// RANGED_HEAL_POWER; travelTo closes distance when out of range 3 entirely. No kiting logic (unlike
// attackStep) — a healer just needs to get in range and heal, never needs to back away from its own
// squad-mate. Store-less: never self-completes on store state, only via targetGone (target gone/no
// longer resolves), handled by isComplete/STEP_KIND above.
function healStep(creep: Creep, spec: TargetSpec, locked: Id<_HasId> | undefined, allowTravel: boolean): StepResult {
  const target = resolveTarget(creep, spec, locked);
  if (!target) return { acted: false, didAct: false };
  const patient = target as Creep;

  // Always keep moving toward the patient, even when already in heal range — heal (a move-kind step, see
  // STEP_KIND) never self-completes except via targetGone, and find:"squadMate" always resolves to
  // SOMETHING (itself included), so a healer that never travels here is permanently parked the instant it
  // lands on this step: it "heals" whatever's nearest (often itself, at full HP) forever and never advances
  // toward wherever it actually needs to be (e.g. still rallying via a PRECEDING moveToRoom step's
  // destination). Screeps permits move + heal the same tick (this mirrors attackStep's own kiting, which
  // already moves and acts together), so travelling here costs nothing when the patient is in range and
  // fixes the freeze when it isn't the healer's own final destination.
  if (creep.pos.inRangeTo(patient.pos, 1)) {
    creep.heal(patient);
    if (allowTravel) creep.travelTo(patient.pos);
    return { acted: true, didAct: true, target: patient.id };
  }
  if (creep.pos.inRangeTo(patient.pos, HEAL_ASSIST_RANGE)) {
    creep.rangedHeal(patient);
    if (allowTravel) creep.travelTo(patient.pos);
    return { acted: true, didAct: true, target: patient.id };
  }
  if (!allowTravel) return { acted: false, didAct: false };
  creep.travelTo(patient.pos);
  return { acted: true, didAct: false, target: patient.id };
}

// Pulls a point's x/y into [1,48], never [0,49] — every tile at x/y 0 or 49 is a live room exit, and a
// fighter mid-fight must never treat one as a legal destination, whether fleeing to it or closing in on
// a hostile that's baiting from on or beside the border. Shared by fleeSpot (the flee destination itself)
// and attackStep's close-in branch (clamping the approached hostile's position before handing it to
// travelTo), so both movement decisions share one guarantee instead of two independent clamps drifting.
function clampInterior(p: { x: number; y: number }, roomName: string): RoomPosition {
  return new RoomPosition(Math.min(48, Math.max(1, p.x)), Math.min(48, Math.max(1, p.y)), roomName);
}

// A tile one step directly away from the threat, mirrored across the fighter's own position — travelTo
// walks toward this point, which walks the fighter backward along the same line the hostile is closing on.
// Clamped to the room interior (see clampInterior): a fighter mid-fight standing on the border, let alone
// routed across it chasing the mirror, is exactly the "baited into an adjacent room" failure this guards
// against. Pinned against that interior boundary (already at x/y 1 fleeing further out), the axis simply
// holds instead of stepping onto the border — the other, still-free axis alone carries the flee, sliding
// along one tile off the wall instead of walking the border itself; only if both axes are simultaneously
// pinned (a corner, with the hostile bearing from outside the room) does the fighter have nowhere left to
// retreat.
function fleeSpot(from: { x: number; y: number; roomName: string }, threat: { x: number; y: number }): RoomPosition {
  const dx = Math.sign(from.x - threat.x) || 1;
  const dy = Math.sign(from.y - threat.y) || 1;
  return clampInterior({ x: from.x + dx, y: from.y + dy }, from.roomName);
}

// How close an armed hostile may get before a Role.flee creep (miner, hauler, repairer — anything with
// no means to fight back) breaks off its current step and retreats. One tile wider than a defender's own
// engagement radius (RANGED_ATTACK_RANGE, 3): these creeps have no counter-fire to make holding at exactly
// 3 safe, so the margin buys a tick of travel before the hostile would be in firing range at all.
export const FLEE_RADIUS = 4;

// The nearest hostile actually capable of damaging an unarmed creep — reputation-flagged (isDangerous,
// same bar dangerCostMatrix/dangerRouteCallback use for pathing avoidance) AND carrying ATTACK or
// RANGED_ATTACK. A merely "hostile"-flagged but unarmed creep (scout, healer, claimer) poses no threat
// worth interrupting work for. undefined when nothing within FLEE_RADIUS qualifies. Ranks by getRangeTo
// (like hostilesWithin's callers elsewhere in this file) rather than findClosestByRange, which several
// of this file's lightweight test position stubs don't implement.
function nearestArmedThreat(creep: Creep): Creep | undefined {
  let nearest: Creep | undefined;
  let nearestRange = Infinity;
  for (const h of creep.room.find(FIND_HOSTILE_CREEPS)) {
    if (!isDangerous(h.owner.username)) continue;
    if (h.getActiveBodyparts(ATTACK) === 0 && h.getActiveBodyparts(RANGED_ATTACK) === 0) continue;
    const range = creep.pos.getRangeTo(h.pos);
    if (range > FLEE_RADIUS || range >= nearestRange) continue;
    nearest = h;
    nearestRange = range;
  }
  return nearest;
}

// Unlike attackStep's kiting (a defender that must hold the room, never get baited across a border), an
// unarmed Role.flee creep has nothing to gain by staying — the room it's fleeing into can only be as bad
// as the one it's already in danger in. Terrain-aware, unlike a plain mirror-the-threat offset: that
// naive math picked its target by coordinates alone and could point straight into a wall (confirmed live
// — a hauler boxed in against a rock formation with the only opening on the threat's side had nowhere to
// go and sat exposed while travelTo failed to make progress toward an unreachable/walled goal). PathFinder
// itself is what Screeps ships for exactly this: `flee: true` runs a Dijkstra flood from the threat and
// returns the nearest tile actually outside `goalRange` that's reachable by real terrain, never a bare
// offset. maxRooms:2 on the caller's travelTo mirrors the old cross-one-border allowance. threat is a
// plain {x,y} (the hostile is always in the fleeing creep's own room — nearestArmedThreat's room.find
// guarantees that — so `from`'s roomName covers both ends; no need to carry the hostile's own roomName).
const FLEE_PLAIN_COST = 2;
const FLEE_SWAMP_COST = 10;
// Priced above plain (see FLEE_PLAIN_COST) so the flee flood steers off roads even though they're
// nominally 2:1 — confirmed live: a fleeing hauler kept picking the road out of a source pocket because
// it was the cheapest-cost tile by the engine's own move-speed accounting, and that road ran it straight
// along the open lane a pursuing hostile could match speed on and eventually corner it against terrain at
// the far end. A discouraged-but-not-impassable cost (still cheaper than swamp) still lets a flee path use
// a road when it's genuinely the only way out, just never merely because it's fractionally faster.
const FLEE_ROAD_COST = FLEE_PLAIN_COST + 1;

// Terrain + road costs for a flee search, since PathFinder.search only auto-applies plainCost/swampCost
// when no roomCallback is given at all — supplying one (needed to price roads and mark obstacles
// impassable) means seeding terrain into the matrix ourselves, or every tile silently reads back as free.
// Deliberately not lib/traveler.ts's Traveler.addStructuresToMatrix: importing that class triggers its
// module-level Creep.prototype.travelTo monkeypatch, which several of this suite's minimal creep/Game
// stubs don't provide a real Creep global for.
function fleeCostMatrix(roomName: string): CostMatrix {
  const matrix = new PathFinder.CostMatrix();
  const terrain = Game.map.getRoomTerrain(roomName);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const t = terrain.get(x, y);
      if (t === TERRAIN_MASK_WALL) continue; // 0xff default already impassable; leave it
      matrix.set(x, y, t === TERRAIN_MASK_SWAMP ? FLEE_SWAMP_COST : FLEE_PLAIN_COST);
    }
  }
  const room = Game.rooms[roomName];
  if (!room) return matrix;
  for (const s of room.find(FIND_STRUCTURES)) {
    if (s.structureType === STRUCTURE_ROAD) {
      matrix.set(s.pos.x, s.pos.y, FLEE_ROAD_COST);
    } else if (s.structureType === STRUCTURE_RAMPART) {
      if (!(s as StructureRampart).my && !(s as StructureRampart).isPublic) matrix.set(s.pos.x, s.pos.y, 0xff);
    } else if ((OBSTACLE_OBJECT_TYPES as readonly string[]).includes(s.structureType)) {
      matrix.set(s.pos.x, s.pos.y, 0xff);
    }
  }
  return matrix;
}

function fleeSpotAcrossRooms(from: RoomPosition, threat: { x: number; y: number }): RoomPosition | undefined {
  const threatPos = new RoomPosition(threat.x, threat.y, from.roomName);
  const result = PathFinder.search(
    from,
    { pos: threatPos, range: FLEE_RADIUS + 1 },
    { flee: true, maxRooms: 2, roomCallback: fleeCostMatrix }
  );
  const dest = result.path[result.path.length - 1];
  return dest && !dest.isEqualTo(from) ? dest : undefined;
}

// For a Role.flee creep: if an armed, reputation-dangerous hostile has closed within FLEE_RADIUS, step
// directly away from it (see fleeSpotAcrossRooms) instead of running the creep's normal step this tick,
// and report true so the caller skips its usual dispatch. False (no travelTo issued) whenever nothing
// qualifies OR no escape tile was found (e.g. fully boxed in — nothing to do but sit), so a caller can
// fall straight through to its normal behavior with no extra cost on the common, threat-free tick. Also
// false while standing in our own room under an active safe mode: hostile creeps there can't deal damage
// at all, so fleeing would only interrupt work for no benefit.
export function fleeThreat(creep: Creep): boolean {
  const threat = nearestArmedThreat(creep);
  if (!threat) return false;
  if (creep.room.controller?.my && creep.room.controller.safeMode) return false;
  const dest = fleeSpotAcrossRooms(creep.pos, threat.pos);
  if (!dest) {
    log.debugCreep(creep.name, `fleeThreat: no reachable escape from armed hostile ${threat.id} — holding`);
    return false;
  }
  log.debugCreep(creep.name, `fleeThreat: fleeing armed hostile ${threat.id} (range=${creep.pos.getRangeTo(threat.pos)}) to (${dest.x},${dest.y})`);
  creep.travelTo(dest, { range: 0, maxRooms: 2 });
  return true;
}

// The nearest living creep of ours that actually heals OTHER creeps, visible in the same room as the
// disarmed defender — walking toward it lets a healer top the defender back up rather than the
// defender continuing to soak hits with nothing to shoot back with. Only considers the CURRENT room
// (like nearestArmedThreat/hostilesWithin above): a healer in a different room isn't reachable this
// tick regardless, and the retreat-home fallback covers that case.
//
// Gated on role, not merely on carrying an active HEAL part: SimpleBaitTower's body also carries HEAL
// (see its own doc — self-preservation for a tank that solicits tower fire), but its steps only ever
// call creep.heal(creep) on itself, never on an ally. Confirmed live: a disarmed defender treated a
// SimpleBaitTower creep as a rescuer, parked at range 1 next to it, and sat there forever — hits never
// reached hitsMax (nothing was ever healing it) so retreatIfDisarmed's release condition never fired.
// DrainHealer's own "heal" step only runs while unsquadded (once squadded, planSquadActions heals
// directly, bypassing the step table — see drainHealer.ts's doc), so it can't be relied on to actually
// heal an unrelated ally like a disarmed defender/attacker. SimpleHealer's "heal" step is the first that
// can: it targets find:"friendly" (any owned creep in the room, self included) unconditionally, every
// tick — see simpleHealer.ts's doc. Add a role here only once it has a step that unconditionally heals
// arbitrary friendlies the same way.
const HEALS_ALLIES_ROLES = new Set<string>(["simpleHealer"]);

function nearestFriendlyHealer(creep: Creep): Creep | undefined {
  let nearest: Creep | undefined;
  let nearestRange = Infinity;
  for (const c of creep.room.find(FIND_MY_CREEPS)) {
    if (c.id === creep.id) continue;
    if (!HEALS_ALLIES_ROLES.has(c.memory.role)) continue;
    if (c.getActiveBodyparts(HEAL) === 0) continue;
    const range = creep.pos.getRangeTo(c.pos);
    if (range >= nearestRange) continue;
    nearest = c;
    nearestRange = range;
  }
  return nearest;
}

// The bunker anchor recorded for `home`, if building has laid one down yet, else the room centre — same
// fallback chain as behaviors/logisticsRunner.ts's homeRoomWaypoint (kept as a separate copy here rather than a
// shared import: transport.ts's version threads through its own logistics-task plumbing, and duplicating
// a two-line lookup is cheaper than adding a cross-file dependency for it).
function homeAnchor(home: string): RoomPosition {
  const anchor = typeof Memory !== "undefined" ? Memory.colonies?.[home]?.anchor : undefined;
  return anchor ? new RoomPosition(anchor.x, anchor.y, home) : new RoomPosition(25, 25, home);
}

// Driven by Role.retreatPart (see its doc): once every part of the role's declared kind has been
// destroyed (hits reduced to 0, so getActiveBodyparts no longer counts it), the creep can no longer do
// the one thing its body was built for — for Defender/Attacker specifically, continuing to run attackStep
// would walk a disarmed husk into (or hold) melee range of a hostile it can no longer even hurt
// (attackStep's own no-RANGED_ATTACK branch treats a body with no ranged weapon as pure melee and closes
// to range 1). Retreats toward the nearest friendly HEAL creep in the room if one is visible (useful
// mid-fight, away from home), else falls back to walking home and PARKING there — the home room's tower
// heals any damaged friendly creep standing in it (see intents/execute.ts's towerHeal), so simply parking
// there passively restores hits with no squad healer required.
//
// CreepMemory.retreating latches the walk-home-and-park leg specifically, once the creep has actually
// reached home: a single tower heal tick revives ONE destroyed part back above 0 hits (Screeps heals the
// most-damaged part first), which would otherwise flip getActiveBodyparts positive again long before the
// creep is actually healed — confirmed live: a defender parked on the home exit tile got one part ticked
// up, immediately read as "rearmed" by a raw part-count check, and walked straight back out into combat
// while 5 of 6 parts sat at 0 hits. Once latched, only hits === hitsMax (not part count) releases it back
// to normal dispatch. Deliberately scoped to the home leg only — the healer-seeking branch below still
// re-reads getActiveBodyparts live every tick even mid-chase, since a creep still out hunting a healer
// (not yet parked) re-evaluating on fresh part counts each tick is the wanted behavior, not the bug.
export function retreatIfDisarmed(creep: Creep, part: BodyPartConstant): boolean {
  const home = creep.room.name === creep.memory.home;
  if (!creep.memory.retreating && creep.getActiveBodyparts(part) > 0) return false;
  const anchor = homeAnchor(creep.memory.home);
  const atAnchor = home && creep.pos.isEqualTo(anchor);
  if (atAnchor) {
    if (creep.hits >= creep.hitsMax) {
      creep.memory.retreating = false;
      return false; // fully healed at the anchor — release back to normal dispatch
    }
    creep.memory.retreating = true;
  }
  const healer = nearestFriendlyHealer(creep);
  if (healer) {
    log.debugCreep(creep.name, `retreatIfDisarmed: no ${part} parts left — retreating to healer ${healer.id}`);
    creep.travelTo(healer.pos, { range: 1 });
    return true;
  }
  if (!atAnchor) {
    log.debugCreep(creep.name, `retreatIfDisarmed: no ${part} parts left, no healer in sight — heading home`);
    // A generic room-centre target with a wide range (the old {range:3} against (25,25)) let Traveler
    // consider itself "arrived" the moment the creep crossed the border, close enough to satisfy the
    // range check without ever actually walking off the edge tile — confirmed live: a disarmed defender
    // sat on the border for exactly one tick before this ran again and re-issued the same near-satisfied
    // move. homeAnchor (the real bunker anchor, same fallback chain as transport.ts's homeRoomWaypoint)
    // is a concrete point deep in the room with no range slack, so travelTo has no "close enough" reading
    // until the creep is actually standing well inside home. Checked against the exact anchor tile (not
    // just room membership) so crossing the border onto the exit tile doesn't get mistaken for "arrived" —
    // confirmed live: a disarmed defender got tower-healed one part's worth on the exit tile itself, which
    // used to satisfy a room-equality "home" check and stop it there, well outside reliable tower range.
    creep.travelTo(anchor);
  } else {
    log.debugCreep(creep.name, `retreatIfDisarmed: no ${part} parts left, home but not fully healed — holding`);
  }
  return true;
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

