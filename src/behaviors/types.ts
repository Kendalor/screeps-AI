import type { RoleName } from "../memory/schema";

// How many creeps may share one resolved target: "allow"/absent = unlimited, "avoid" = exclusive (1), a number = that many.
// Sources ignore this and use their open harvest-tile count as the cap instead.
export type Share = "allow" | "avoid" | number;

// Selection strategy a step declares outright, no implicit fallback: "nearest" (default) is closest, "largest" ranks a drop pile by amount, "mostProgress" ranks a construction site closest to done, "mostDamaged" ranks a structure by lowest hits fraction (the repair counterpart of "mostProgress"), "mostThreatening" ranks a hostile creep by body composition (attacker > healer > unarmed), nearest as the tiebreaker, "nearestToFlag" ranks by range to creep.memory.demolishFlag's live position rather than the acting creep's own position (falls back to "nearest" whenever the flag is unset or gone), "nearestDamaged" (SimpleHealerRole's own use) ranks by lowest hits fraction among patients within heal-assist range of the acting creep, then falls back to plain range-to-self for anyone farther out — so a healer stops for a hurt ally standing right next to it instead of always beelining for whoever's most hurt anywhere in the room.
export type Prefer = "nearest" | "largest" | "mostProgress" | "mostDamaged" | "mostThreatening" | "nearestToFlag" | "nearestDamaged";

export type TargetSpec =
  | {
      find: "structure";
      // A single type or a list — a list pools every matching structureType into one candidate set
      // (e.g. STRUCTURE_SPAWN and STRUCTURE_EXTENSION together), same as "any" does across find-kinds.
      type: StructureConstant | StructureConstant[];
      where?: "notFull" | "hasEnergy" | "damaged";
      // Which resource `where`'s notFull/hasEnergy reads capacity for. Defaults to RESOURCE_ENERGY.
      // "any" reads the store's general (all-resources) free/used capacity instead — for a structure that
      // never holds energy at all, e.g. a mineralMiner's container, where the room's actual mineral type
      // isn't known at this static step-table's definition time.
      resource?: ResourceConstant | "any";
      share?: Share;
      prefer?: Prefer;
      // Positional discriminator, the only way to tell same-typed structures apart by where they sit:
      //  - "assignedSource": range 2 of the creep's memory.sourceId — a miner's own source container
      //    (range 1, the miner stands on it) or link (range 2, pulled back so the miner's range-1 tile
      //    stays free — see operations/mining.ts's linkSpot).
      //  - "controller": range 2 of the room controller — the controller container (an upgrader parked on
      //    it stays in upgrade range). This is the hauler's fill target.
      //  - "notController": the complement — every container that is NOT the controller's, i.e. the source
      //    containers a hauler draws from. Keeps a hauler from draining the very container it fills.
      near?: "assignedSource" | "assignedMineral" | "controller" | "notController";
      // Only qualify a store-holder while its energy fraction is BELOW this (0..1). Lets the hauler top the
      // controller container to a floor (0.7) and then leave it alone, rather than fighting the upgraders
      // that drain it for every last unit. Combines with `where` (both must pass).
      fillTo?: number;
      // Only qualify a structure while its hits fraction is BELOW this (0..1) — the repair counterpart of
      // fillTo. Lets a miner start repairing its container only once it has decayed past a floor (0.7)
      // rather than chasing every point of decay. Combines with `where` (both must pass).
      repairBelow?: number;
      // Exclude a candidate the creep can't reach before it dies (see requireReachableAlive doc below).
      requireReachableAlive?: boolean;
      // See alsoAdjacentRooms doc below (shared across every gather-shaped spec).
      alsoAdjacentRooms?: boolean;
    }
  // unlessSpawnNeedsEnergy: skip this pool while the room's spawn/extensions aren't full, so builders/
  // upgraders leave ground piles for the hauler (whose own gather step has no such gate) rather than
  // competing with it for the exact energy the spawn system needs to produce replacements.
  //
  // requireReachableAlive: exclude a candidate whose straight-line range exceeds the creep's own
  // ticksToLive — a lower bound on travel time (a hauler is built 1 MOVE per CARRY, so it never fatigues
  // and covers a tile in at most 1 tick), cheap enough to check per-candidate without a real path search.
  // Keeps a transport creep near the end of its life from locking onto a pickup (e.g. a remote container)
  // it will die en route to, stranding the energy and wasting the trip. Undefined/false means unchecked,
  // matching every existing caller's behavior.
  //
  // alsoAdjacentRooms: widen the pool to rooms bordering the creep's own, but ONLY as a fallback when the
  // current room has nothing — a builder stranded in a Source Keeper room (no safe container/drop exists
  // there until the road it's trying to build gets built) would otherwise starve outright, since every
  // gather-shaped search is normally scoped to creep.room alone. Same-room candidates always win when any
  // exist (ranked by the usual findClosestByPath, which only makes sense within one room); the adjacent
  // pool only kicks in when the local search comes up empty, and is ranked by cheap room-hop + in-room
  // distance rather than a real cross-room PathFinder search per candidate (mining.ts's own doc flags that
  // cost: 2%+ of colony CPU when run per-source every tick). Requires live vision into the neighbor
  // (Game.rooms[name]) — an unseen room contributes nothing, same as any other vision-gated read here.
  | { find: "dropped"; share?: Share; prefer?: Prefer; unlessSpawnNeedsEnergy?: boolean; requireReachableAlive?: boolean; alsoAdjacentRooms?: boolean }
  | { find: "tombstone"; share?: Share; prefer?: Prefer; requireReachableAlive?: boolean; alsoAdjacentRooms?: boolean }
  | { find: "ruin"; share?: Share; prefer?: Prefer; requireReachableAlive?: boolean; alsoAdjacentRooms?: boolean }
  | { find: "source" }
  // The room's mineral deposit — parallel to find:"source", not merged with it, since a mineral has no
  // continuous-regen "temporarily empty" case to distinguish and is exactly one per room. See
  // assignedMineral (near, above) for a mineralMiner's own deposit vs. find:"mineral"'s room-wide search.
  | { find: "mineral" }
  // structureType/near scope which sites qualify, mirroring the structure spec: a miner builds only the
  // CONTAINER site at its own source, not whatever construction site happens to be nearest.
  // onlyIfCarryOver: a single-CARRY creep (e.g. the base upgrader body) can't afford a long round trip
  // to refill after building — sites farther than this range from the controller are excluded unless the
  // creep's own CARRY part count exceeds the given floor. Range is against the room's controller, not the
  // creep's position, since it gates by the site's inherent distance from where the creep actually works.
  | {
      find: "constructionSite";
      structureType?: StructureConstant;
      near?: "assignedSource" | "assignedMineral" | "controller" | "notController";
      share?: Share;
      prefer?: Prefer;
      onlyIfCarryOver?: { carry: number; range: number };
    }
  | { find: "controller" }
  | { find: "creep"; role: RoleName | RoleName[]; where?: "notFull" | "hasEnergy"; share?: Share; prefer?: Prefer } // friendly creep as source/sink, filtered by role
  | { find: "hostile"; prefer?: Prefer } // enemy creep in the room; defaults to "nearest" — a defender wants "mostThreatening" instead
  // Any hostile-owned structure in the room (FIND_HOSTILE_STRUCTURES) — towers, spawns, extensions, an
  // invader core, anything another player/faction owns. creep.attack() accepts a Structure exactly as it
  // does a Creep, so this feeds the same "attack" step as find:"hostile"; unlike find:"structure" there's
  // no `type` to scope by, since an attacker wants to hit whatever's there regardless of kind.
  | { find: "hostileStructure"; prefer?: Prefer }
  // A hostile player's construction site (FIND_HOSTILE_CONSTRUCTION_SITES). Unlike every other structure
  // target, a construction site has no attack() call at all — the engine destroys it the instant any
  // creep merely stands on its tile (see the "trample" step below), so this spec exists purely to be
  // resolved by that step, never by "attack".
  | { find: "hostileConstructionSite"; prefer?: Prefer }
  // The acting creep's squad-mates: every friendly creep sharing the same memory.op value (see
  // operations/operation.ts's owned(), the same op-based ownership stamp), INCLUDING the acting creep
  // itself — a healer can target itself. Squad membership is derived, not stored (see ADR 0006): there is
  // no squadId, just "same op". Ranked with "mostDamaged" (a healer's use), same as a repair pool.
  | { find: "squadMate"; prefer?: Prefer }
  // Any owned creep in the room regardless of role, INCLUDING the acting creep itself — SimpleHealer's
  // room-wide "heal whoever's hurt" pool, unlike find:"creep" (which requires a role filter and always
  // excludes self) and find:"squadMate" (which scopes to memory.op, so a solo non-squad creep would only
  // ever match itself). where:"damaged" is the only Where that makes sense here in practice, but any
  // matchesWhere case is accepted since a friendly-creep candidate carries a store like any other.
  | { find: "friendly"; where?: "notFull" | "hasEnergy" | "damaged"; prefer?: Prefer }
  | { find: "id"; id: Id<_HasId> }
  // Groups several specs into one pool (e.g. every viable energy sink) so a step picks the nearest
  // across kinds in one shot instead of falling through a priority-ordered chain of single-kind steps.
  // Each member keeps its own where/share/prefer; "any" itself only decides how the merged pool is ranked.
  // Members exclude "any" (no nesting), "id" and "controller" (both singular, not a search pool).
  | { find: "any"; of: Exclude<TargetSpec, { find: "any" | "id" | "controller" }>[]; prefer?: Prefer };

// Precondition on the CREEP's own state (not the target's `where`); "empty" gates a gather step so a
// loaded hauler delivers first. "damaged"/"healthy" gate on hits vs hitsMax — "damaged" marks a step
// complete/skip once hits < hitsMax (so it only runs while at full health), "healthy" marks it
// complete/skip once hits === hitsMax (so it only runs while damaged). Used by SimpleBaitTowerRole to
// switch between advancing on a target room and fleeing/healing.
export type When = "empty" | "damaged" | "healthy";

export type Step = ({
  when?: When;
  oneShot?: boolean; // complete on first act instead of waiting for store to empty; needed for creep sinks, which never "fill"
}) &
  (
    | { do: "harvest"; from: TargetSpec }
    | { do: "withdraw"; from: TargetSpec; resource?: ResourceConstant }
    | { do: "pickup"; from: TargetSpec }
    // Like withdraw/pickup but picks the right game call per resolved target — a "from" spec (e.g.
    // energySourceGroup()) may resolve to either a dropped Resource (needs pickup) or a store-holder
    // (needs withdraw), and the step shouldn't have to commit to one verb ahead of knowing which.
    | { do: "gather"; from: TargetSpec; resource?: ResourceConstant }
    | { do: "transfer"; to: TargetSpec; resource?: ResourceConstant }
    | { do: "build"; at?: TargetSpec }
    | { do: "repair"; at: TargetSpec; upTo?: number }
    // Dismantle a structure (e.g. an invader core) at range 1. Store-less like attack — never
    // self-completes on store state, only via targetGone once the structure is destroyed.
    | { do: "dismantle"; at: TargetSpec }
    // urgentBelow gates this step to a no-op fall-through unless the room's controller is genuinely at
    // risk of downgrading (controller.ticksToDowngrade < urgentBelow) — lets a role list the SAME verb
    // twice: once early (jump the queue when downgrade is imminent) and once at its normal wraparound
    // spot (the default, ungated fallback every worker-ish role already has).
    | { do: "upgrade"; urgentBelow?: number }
    | { do: "reserve" } // reserve the current room's controller — a claimer's whole job, once it has arrived
    | { do: "claim" } // claimController on the current room's controller — a colonizer's whole job, once it has arrived
    // attackController the current room's controller unconditionally — AttackControllerRole's whole job,
    // once it has arrived (see behaviors/roles/attackController.ts). Unlike reserveStep/claimStep, where
    // attackController is only a side-branch chipping away at someone else's reservation before the real
    // verb (reserveController/claimController) can succeed, this role never reserves or claims at all —
    // downgrading (or, once already neutral, holding an owned/reserved controller's decay at bay) is the
    // entire point, so every tick just calls attackController again. Store-less, never self-completes on
    // store state — only targetGone (no controller found, which can't really happen) ends it.
    | { do: "attackController" }
    // Top up ticksToLive at a spawn in the creep's targetRoom, but only below `below` ticks — a no-op
    // (falls through to the next step) above that threshold or while targetRoom has no spawn yet. Unlike
    // reserve/claim this never holds the creep in place once satisfied: renewCreep is called once per
    // tick it's actually needed, same "act or fall through" shape moveToRoom already has with no dest.
    | { do: "renew"; below: number }
    // Walks to a spawn in the creep's own room and recycleCreep's itself, but only once the room's
    // energyCapacityAvailable has reached `aboveEnergyCapacity` — a no-op (falls through) below that
    // threshold or while the room has no spawn yet. Settler's use: once its target room can afford
    // SELF_SUFFICIENT_ENERGY_CAP on its own, the room's normal operations (Bootstrap et al) take over and
    // the settler recycles itself for a partial energy refund rather than idling out its natural lifespan.
    | { do: "recycle"; aboveEnergyCapacity: number }
    // Pre-empting leg for every SingleTargetFlagOperation-spawned role (SimpleBaitTowerRole,
    // DemolisherRole, SimpleHealerRole, AttackControllerRole — the flag/oneShot family, see
    // operations/singleTargetFlagOperation.ts): a no-op fall-through while creep.memory.op's originating
    // operation is still listed in ColonyMemory.singleTargetOps (the flag handoff hasn't been withdrawn
    // and, for a "oneShot" op, hasn't self-terminated yet — see SingleTargetOpState's "wanted<=0 reads as
    // absent" rule). Once that entry is gone — the flag was pulled, or removeOperation was run, while this
    // creep was still alive — there's no longer any operation left to do the creep's job for, so it walks
    // to a spawn in its OWN home room and recycleCreep's itself for a partial refund rather than idling out
    // its natural lifespan doing nothing (SingleTargetFlagOperation never re-adopts an orphaned creep; it's
    // filtered out of `owned()` the moment memory.op no longer matches any live instance's name). Ownerless
    // creeps (memory.op unset — predates its requester) always no-op here, same fail-open convention
    // `owned()` itself uses. Meant to be listed FIRST in a role's step table so it pre-empts every other
    // step uniformly the instant the operation disappears, rather than being woven into each step
    // individually.
    | { do: "recycleIfOperationGone" }
    // Engage the nearest hostile: ranged-attack at range 3 if the body has RANGED_ATTACK, else close to
    // melee range 1. Never self-completes on store state (a fighter carries nothing) — only targetGone
    // (no hostile left in the room) ends it, same as reserve.
    | { do: "attack"; from: TargetSpec }
    // Walks onto the resolved hostile construction site's own tile — screeps.com destroys an enemy's
    // construction site the instant any creep occupies it, no attack() call involved (see
    // find:"hostileConstructionSite"'s doc). Store-less, never self-completes on store state, only via
    // targetGone (the site is gone once trampled, or was never there).
    | { do: "trample"; at: TargetSpec }
    // Heal the resolved target: creep.heal() at range 1 (full HEAL_POWER), creep.rangedHeal() at range
    // 2-3 (reduced RANGED_HEAL_POWER), closing distance via travelTo when out of range 3 entirely. No
    // kiting logic (unlike attackStep) — a healer just needs to get in range and heal. Store-less like
    // attack — never self-completes on store state, only via targetGone (target gone/no longer resolves).
    | { do: "heal"; at: TargetSpec }
    | {
        do: "moveToRoom";
        room?: string;
        to?: "scoutTarget" | "targetRoom" | "buildTargetRoom" | "repairTargetRoom" | "defendTargetRoom" | "attackTargetRoom";
        // Steer wide of source keepers and hostile creeps while travelling (see moveToRoom's
        // dangerCostMatrix). Only meaningful for a role with no means to fight back — a defender/attacker
        // walking toward hostiles on purpose must never set this, or it'd path away from its own target.
        avoidDanger?: boolean;
      } // static room, or a memory field name, to read the destination + memory.route from creep memory
    // Moves toward a concrete tile read from a memory field, refreshed every tick by the owning operation
    // — for rallying onto a MOVING point (a live squad anchor), not a room. moveToRoom's room-membership
    // arrival check is the wrong primitive there: a straggler converging on another creep's position needs
    // a real destination tile, or two stragglers each converging on "whichever room the other is in this
    // tick" chase each other back and forth across a border forever (confirmed live — see drainRallyPos).
    // No-ops (falls through, same as moveToRoom with no dest) while the field is unset. Never self-completes
    // on arrival by itself; the NEXT step (e.g. heal/attack) takes over once in its own range, same
    // structure as moveToRoom+attack/heal today.
    | { do: "moveToPos"; to: "drainRallyPos" | "paradeRallyPos" }
    | { do: "sit"; pos: { x: number; y: number } } // for the anchor logistics sitter
    // Shared retreat leg for every flag-following role (SimpleBaitTowerRole, DemolisherRole,
    // SimpleHealerRole; when:"healthy" gates this to only run while damaged — see When's doc): while
    // still standing in creep.memory.targetRoom, path toward the nearest exit tile of the CURRENT room
    // (running for the border); once already outside targetRoom, step one tile further off that exit
    // tile (so it isn't left sitting in the doorway) instead. Self-heals every tick either way.
    // Store-less, never self-completes on store state — only the when:"healthy" gate ends it, once hits
    // recovers to hitsMax.
    | { do: "fleeAndHeal" }
    // Plain advance leg for flag-following roles that do their combat/heal work in a separate step
    // (DemolisherRole's "dismantle"): walks toward creep.memory.followFlag's LIVE position, read straight
    // from Game.flags every tick — no memory-cached destination the way moveToPos's drainRallyPos/
    // paradeRallyPos are (an owning operation would have to refresh those every tick anyway; a flag is
    // already live in Game.flags, so the step just reads it directly). Dragging the flag in the client
    // redirects the creep immediately. Falls back to moveToRoom's targetRoom behavior when followFlag is
    // unset or the named flag no longer exists (removed, or a creep that predates this field) — never a
    // standing no-op. Never self-completes on its own; whatever step follows it (or, for
    // SimpleBaitTowerRole's cousin below, the when:"damaged" gate) is what stops it. SimpleHealerRole uses
    // its own "healerAdvance" variant below instead — see that step's doc for why.
    | { do: "moveToFlag" }
    // SimpleBaitTowerRole's own advance leg — moveToFlag's simple walk PLUS the self-heal-while-moving and
    // attack-nearest-hostile-structure/creep behavior a lone bait creep needs, since it has no separate
    // "attack" step of its own the way Demolisher/SimpleHealer do. Same live followFlag tracking and
    // moveToRoom fallback as moveToFlag. Never self-completes here; the caller's when:"damaged" gate is
    // what stops this step once the creep takes a hit.
    | { do: "baitTowerAdvance" }
    // SimpleHealerRole's own advance leg — moveToFlag's simple walk PLUS yielding (letting the creep's
    // "heal" step take over as primary) the moment any friendly creep in the room is damaged, not only once
    // the flag's exact tile is reached. moveToFlag's plain "arrived on the exact tile" yield is too late for
    // a healer: the flag's exact tile can be occupied or otherwise unreachable, which would leave the
    // healer marching for it forever, walking straight past a hurt ally without ever stopping to heal (see
    // interpreter.ts's healerAdvanceStep). Kept as its own step rather than folded into moveToFlag so
    // DemolisherRole/AttackControllerRole's advance behavior stays untouched by SimpleHealer's needs.
    | { do: "healerAdvance" }
  );

export interface TaskState {
  step: number;
  target?: Id<_HasId>;
}

// What a body calculator may know beyond the energy budget (e.g. container/link presence).
export interface BodyContext {
  hasContainer: boolean;
  hasLink: boolean;
  // A container construction site exists at the source but isn't built yet. Grants a drop-miner one CARRY
  // so it can harvest into its store and help build (and later repair) its own container, rather than
  // dropping everything and standing idle while a builder does all the work.
  hasContainerSite?: boolean;
  roads?: boolean; // whether the creep's route is paved; unused by body calculators today, reserved for MOVE-ratio tuning
  // This body is for a source in a remote room, not the home room — no paved road home is assumed, so a
  // miner needs a full MOVE per non-MOVE part rather than the home bunker's road-subsidized half ratio.
  remote?: boolean;
  // Only meaningful when remote is true: is the remote room currently reserved by us? Reserved sources
  // regen at the same 10/tick rate as home sources (worth the full WORK target); unreserved ones regen at
  // half that, so staffing to the full target would only buy idle WORK parts.
  reserved?: boolean;
  // The home room's RCL — only a few body calculators (e.g. supply, splitting into two smaller creeps
  // from RCL6) need this; most infer everything from energy/hasContainer/hasLink instead.
  controllerLevel?: number;
}

export interface RoleDef {
  body: (energy: number, ctx: BodyContext) => BodyPartConstant[];
  steps: Step[];
  priority: number;
  // Opt in to opportunistic en-route pickup while travelling to a gather target (behaviors/sweep.ts).
  sweep?: boolean;
  // Opt in to stepping off a road tile once settled in to build/repair/upgrade, so the creep doesn't
  // block travelling creeps for the whole job (behaviors/roadAvoidance.ts).
  doNotBlockRoads?: boolean;
  // Opt in as a road user: a role that spends its working life pathing between rooms/targets rather
  // than parking on one tile (behaviors/roadAvoidance.ts). stepOffRoad only evacuates for these —
  // no point ceding a tile when nothing nearby actually wants to walk through it.
  mover?: boolean;
  // Opt in to fleeing an armed hostile (behaviors/interpreter.ts's fleeThreat) instead of working on
  // obliviously. Only non-combat roles want this — see Role.flee's doc for the full rationale.
  flee?: boolean;
  // Opt in to retreating home once every part of this kind has been destroyed by combat damage
  // (behaviors/interpreter.ts's retreatIfDisarmed) — see Role.retreatPart's doc for the full rationale.
  retreatPart?: BodyPartConstant;
  // Opt in to bypass the step-table dispatch entirely — see Role.dispatch's doc (behaviors/roles/role.ts)
  // for the full rationale.
  dispatch?: "logistics" | "steward";
}
