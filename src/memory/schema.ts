// ALL memory interfaces. Each field is owned by exactly one system; others read it via the snapshot, never write it.

import type { RoomType } from "../lib/roomName";
import type { TaskState } from "../behaviors/types";
import type { LogisticsTask } from "../logistics/types";
import type { LogLevel } from "../lib/log";
import type { XY } from "../lib/geometry";
import type { Reputation } from "./reputation";

declare global {
  interface Memory {
    version: number;
    colonies: Record<string, ColonyMemory>;
    scouting: ScoutingMemory;
    expansion: ExpansionMemory;
    stats: StatsMemory;
    metrics: Record<string, ColonyMetricsMemory>; // cross-tick harvest-rate window; everything else in a report is derived fresh
    // Latest valid-day avgPrice/stddevPrice per resource, from Game.market.getHistory() — owned by
    // empire/market.ts, refreshed every MARKET_SCAN_INTERVAL ticks (tier-3) or via scanMarket() console command.
    market?: MarketMemory;
    // Console-editable player reputation (Memory.playerReputation["Foo"] = "hostile"), also written
    // automatically when we observe a player's creep attack us — see memory/reputation.ts's
    // recordHostileAction. Absent entries default to "neutral" (reputationOf), never assumed hostile.
    playerReputation?: Record<string, Reputation>;
    logLevel?: LogLevel; // set via the in-game console (commands/console.ts); absent means "error" only
    debugMetrics?: boolean; // set via the in-game console (commands/console.ts); toggles the right-aligned debug panel
    // Creep names / colony room names currently opted into log.debugCreep/log.debugRoom tracing (see
    // lib/log.ts), set via the in-game console's debugCreep/debugColony commands. Independent of logLevel:
    // a debug call only ever prints for a tag listed here, no matter the global level. Absent means no
    // tracing anywhere — the common case, so a fresh Memory need not initialize these to `[]`.
    debugCreeps?: string[];
    debugColonies?: string[];
    // Disables pickRemotes selection empire-wide (mining/pickRemotes.ts) — set via the in-game console
    // or (today) directly by an integration test's patchMemory, to isolate a scenario's spawn economics
    // from a competing remote-mining fleet without faking scout data/terrain to avoid it being
    // discovered. Absent/false means remote mining runs normally. A real per-colony configuration system
    // is a nice-to-have for later; this single empire-wide flag is deliberately the minimal version.
    debugDisableRemoteMining?: boolean;
  }

  interface CreepMemory {
    home: string; // colony room name
    role: RoleName;
    op?: string; // requester that ordered this creep, as `kind:room`; absent means unowned (predates its requester)
    sourceId?: Id<Source>; // singular — no multi-source miner assignment
    task?: TaskState; // current behavior progress — owned by behaviors/interpreter.ts
    // Current transport assignment — owned by intents/execute.ts (write) via Logistics.intents();
    // empire/creeps.ts's transport runner reads and consumes `current`, never writes it directly. The
    // whole trip is one chain (pickup -> ... -> deliver) nested in `current.next`; runTransport promotes
    // `current.next` as each leg completes, so there is no separate follow-up field here.
    logistics?: { current?: LogisticsTask };
    // The steward's current carry destination (storage/terminal), owned by behaviors/stewardBehavior.ts alone —
    // no planner/intent involved, since a steward's job is decided and executed in the same tick with
    // nothing worth persisting across a re-plan (unlike transport's multi-leg chain).
    stewardDest?: Id<StructureStorage> | Id<StructureTerminal> | Id<StructureLink>;
    scoutTarget?: string; // room a scout is assigned to reach; cleared by moveToRoom on arrival
    targetRoom?: string; // a remote worker's permanent destination room (its source's room); NOT cleared on arrival, unlike scoutTarget
    // A builder's current cross-room construction assignment (home or a remote room with outstanding
    // sites), owned by operations/construction.ts. Not cleared on arrival like scoutTarget: the builder keeps
    // working sites in this room until Building reassigns it once the room's backlog clears.
    buildTargetRoom?: string;
    // The repairer equivalent of buildTargetRoom: a repair creep's current cross-room upkeep assignment
    // (home or a remote room with tower-uncovered decay), owned by operations/repairing.ts. Same
    // not-cleared-on-arrival rule — the repairer keeps working this room until Repairing reassigns it.
    repairTargetRoom?: string;
    // The defender equivalent of repairTargetRoom: which invaded room (home or a remote) this defender is
    // currently sent to fight in, owned by operations/defense.ts. Same not-cleared-on-arrival rule — the
    // defender keeps fighting there until Defense reassigns it (danger cleared or a worse room appeared).
    defendTargetRoom?: string;
    // The attacker equivalent of defendTargetRoom: which room this attacker is currently sent to clear,
    // owned by operations/attack.ts. Same reassignment rule as defendTargetRoom — one Attack operation
    // per colony pools every queued target (ColonyMemory.attacking) and reassigns its one attacker to the
    // next open target once its current one clears, so a surviving attacker carries over between rooms
    // instead of a fresh one spawning per target.
    attackTargetRoom?: string;
    // A drain squad member's rally destination TILE (not just a room — see moveToPos), owned by
    // operations/drain.ts, recomputed every tick for every unsquadded member (assembling, or a replacement
    // still catching up). Points at the squad's live anchor tile once one exists, else the staging room's
    // center pre-assembly. Room-membership-only rallying (moveToRoom) let two stragglers each converging on
    // "whichever room the other currently stands in" chase each other back and forth across a border
    // forever, since each one's destination flipped sides the instant its target crossed — confirmed live.
    drainRallyPos?: XY & { room: string };
    // WHICH squad (by owning op name, e.g. "drain:W1N1" — the same opName stamp as `op` above) this creep
    // is a currently-joined member of, or absent if none. A bare boolean here would be ambiguous the moment
    // more than one squad-bearing operation exists (ADR 0007's Squad entity is generic infrastructure —
    // Attack/Defense are explicit candidates to gain squad movement later, see docs/drain-squad-handoff.md's
    // open issues): "joined" alone doesn't say joined to WHAT, and a stale `true` left over from one
    // dissolved squad could be misread by a different operation checking the same field. Storing the op
    // name makes a check self-scoping (`c.memory.squadJoined === this.name`) with no separate lookup, and a
    // stale value from another op's squad simply never matches.
    //
    // Written/cleared via the setSquadJoined/clearSquadJoined intents (execute.ts), owned by whichever
    // operation's squad the creep joins (currently only operations/drain.ts). Squad membership used to be
    // recomputed from scratch every tick purely off live position (room equality, then world-coordinate
    // range after that was found buggy), which meant a border-straddling formation's membership set could
    // flicker between two different tick-to-tick readings of the SAME underlying event ("has this creep
    // joined the squad") even though nothing about whether it belongs had actually changed — confirmed live:
    // 2 members straddling a border vanished from the plan one tick, reappeared the next, forever. Membership
    // is a STATE (a creep joins once, stays joined until it leaves/dies), not a per-tick recomputation, so
    // it's now persisted here exactly like any other stateful assignment (compare logistics.current,
    // buildTargetRoom): Drain.squadState() reads this field directly instead of re-deriving "is this creep
    // part of the squad right now" from position every tick. Cleared when the creep drops out of squad
    // control (dissolved, or explicitly left) — never left stale on a creep that continues to exist under a
    // different assignment.
    squadJoined?: string;
    // A parade squad member's rally destination TILE — the Parade equivalent of drainRallyPos above, same
    // reasoning (a real point, not a room, or two stragglers converging on each other's current room chase
    // each other across a border forever). Owned by operations/parade.ts, recomputed every tick for every
    // unsquadded member: the squad's live anchor once one exists, else the assembly point near home.
    paradeRallyPos?: XY & { room: string };
    // A flag-following creep's own originating flag NAME, stamped once at spawn time from the owning
    // operation's own ColonyMemory.*Flag field (simpleBaitTowerFlag/demolishFlag/simpleHealFlag —
    // whichever operation spawned this creep). Shared by every "walk toward a live flag" role
    // (SimpleBaitTowerRole, DemolisherRole, SimpleHealerRole): the moveToFlag step reads
    // Game.flags[followFlag]?.pos live every tick — no snapshot-side position resolution needed (unlike
    // Parade's paradeGoal/paradeRallyPos): the interpreter already runs against live Game.* objects, so
    // the creep can just look the flag up itself. Undefined means either the flag never had a name to
    // record, or (rare) the creep predates this field.
    followFlag?: string;
    lastRoom?: string; // room a scout was standing in when last (re)assigned; avoided by the next pick unless it's the only option
    route?: RouteMemory; // precomputed room-by-room route for long-haul movement, walked by moveToRoom
    // Last non-OK return code a colonizer's claimController call hit, owned by behaviors/interpreter.ts's
    // claimStep alone. Purely diagnostic/logging (the log line fires once per distinct code) — NOT what
    // Colonize's claimFailedPermanently reads to decide the target is unwinnable; see claimOwnedByOther
    // below for that. Set the first time a given code is seen; cleared back to undefined the tick it's
    // absent (i.e. the claim finally landed), so a stale code from a past failure can't be misread as
    // current. Typed to claimController's own return union, not the broader ScreepsReturnCode — it
    // includes ERR_ACCESS_DENIED (a shard-access gate), which isn't part of that general union.
    claimError?: CreepActionReturnCode | ERR_FULL | ERR_GCL_NOT_ENOUGH | ERR_ACCESS_DENIED;
    // True once claimStep has seen the target controller genuinely owned by another player
    // (controller.owner !== undefined) — the ONE unrecoverable claim failure. Deliberately separate from
    // claimError: the engine's ERR_INVALID_TARGET is ambiguous, covering both "owned by someone" (this,
    // terminal) and "reserved by someone" (attackController fights this down over time — a colonizer can
    // die mid-fight and a fresh one picks up where the reservation level left off, never terminal on its
    // own). Colonize's claimFailedPermanently reads this flag alone, not claimError, so a contested-but-
    // winnable reservation fight never silently tears the operation down.
    claimOwnedByOther?: boolean;
    // Latches Role.retreatPart's walk-home-and-park leg once a disarmed creep has actually reached its
    // home anchor (behaviors/interpreter.ts's retreatIfDisarmed) — see that function's own doc for why a
    // raw getActiveBodyparts re-check alone isn't enough (a single tower-heal tick can revive one part
    // above 0 hits long before the creep is genuinely healed). Cleared once hits reaches hitsMax again.
    retreating?: boolean;
  }

  interface RoomMemory {
    scouted?: ScoutInfo; // written by scouting system only
  }
}

export type RoleName =
  | "bootstrap"
  | "miner"
  | "hauler"
  | "supply"
  | "transport"
  | "steward"
  | "upgrader"
  | "builder"
  | "repair"
  | "sitter"
  | "scout"
  | "claimer"
  | "colonizer"
  | "settler"
  | "pioneer"
  | "defender"
  | "attacker"
  | "drainAttacker"
  | "drainHealer"
  | "paradeMember"
  | "simpleBaitTower"
  | "demolisher"
  | "simpleHealer"
  | "attackController";

export interface ColonyMemory {
  anchor?: { x: number; y: number }; // owned by building
  sources: Record<Id<Source>, SourceMemory>; // owned by mining
  links?: LinkNetworkMemory; // owned by links
  remotes: RemoteMemory[]; // the selected remote rooms + their mined sources; owned by mining (pickRemotes writes it)
  // Consecutive reevaluate passes each still-selected source has failed to make the cut on, keyed by
  // source id — owned by mining (pickRemotes writes it). A source's already-built claim (roads,
  // container) is a sunk cost that only pays back over time, so eviction requires several consecutive
  // bad passes, not a single one — see pickRemotes.ts's EVICTION_STRIKES_THRESHOLD. Absent/0 means
  // "currently making the cut, or never selected." Entries for sources no longer selected at all (fully
  // evicted, or never picked) are pruned by pickRemotes each reevaluate pass so this can't grow unbounded.
  remoteStrikes?: Partial<Record<Id<Source>, number>>;
  danger: number; // owned by defense
  // Target rooms this colony is actively colonizing (sponsoring a colonizer/settler for), owned by
  // colonize.ts. Written once when a flag/auto-pick resolves this colony as the sponsor
  // (addColonizeTarget), read every tick by Colony's constructor to attach a real Colonize operation per
  // listed target — the durable equivalent of `remotes` above, so the operation's existence is a plain
  // memory fact rather than derived indirectly from a live colonizer/settler creep's own memory (the
  // latter was fragile: nothing observed it until a creep already existed, so the handoff from "flag
  // resolved" to "operation attached" had a real gap). Removed (removeColonizeTarget) once the target's
  // job is done (reached SELF_SUFFICIENT_ENERGY_CAP) or permanently failed (terminal claimController
  // error) — see colonize.ts's own removal logic.
  colonizing: string[];
  // Which of `colonizing`'s targets was added by a live flag, and that flag's name — target room key,
  // flag name value. Only present for flag-sponsored targets; an auto-picked one (pickColonyTargets.ts)
  // has no entry, since there's no flag whose lifetime it could be tied to. Lets colonizeFlags.ts tie a
  // target's lifetime to its specific originating flag (see that file's header) even though `colonizing`
  // itself is a plain target list with no per-entry origin otherwise — removing the flag drops just this
  // target, and Colonize's own completion-removal (removeColonizeTarget) also removes this entry so a
  // finished/failed colonize retracts its flag instead of leaving a stale marker behind.
  colonizingFlags?: Record<string, string>;
  // Target rooms this colony is actively attacking (sponsoring an attacker for), owned by attack.ts —
  // the combat equivalent of `colonizing` above, same durable-memory-fact shape: written once by a flag
  // handoff (addAttackTarget), read every tick by Colony's constructor to attach a real Attack operation
  // per listed target, removed (removeAttackTarget) once that room has vision and no hostile creeps left.
  attacking: string[];
  // The attacking equivalent of colonizingFlags above — same shape, same reasoning (flag-sponsored
  // targets only; auto-picked ones from remoteInvaderAttacks.ts have no entry).
  attackingFlags?: Record<string, string>;
  // Target rooms this colony is sponsoring a defender for beyond its own home/remotes (a flag-requested
  // rescue of another colony's room, or any arbitrary room), owned by defense.ts — the defensive
  // equivalent of `attacking` above, same durable-memory-fact shape: written once by a flag handoff
  // (addDefendTarget), read every tick by Defense.desiredCreeps/intents to pool a defender onto it
  // alongside home/remote hostiles, removed (removeDefendTarget) once that room has vision and no
  // hostile creeps left. Home and this colony's own remotes are never listed here — Defense already
  // covers those unconditionally (see roomsWithHostiles); this is strictly for rooms outside that set.
  defending: string[];
  // The defending equivalent of colonizingFlags/attackingFlags above — same shape, same reasoning.
  defendingFlags?: Record<string, string>;
  // The single room this colony is currently draining (sponsoring a drain squad for), owned by drain.ts —
  // a scalar, unlike colonizing/attacking above: the PRD (#34/ADR 0006) fixes exactly one drain target per
  // colony at a time, which is also what lets squad membership be derived from `op` alone with no squadId
  // (see ADR 0006's "squad membership is derived, not stored"). Written by a flag handoff (issue #38,
  // not yet built) the same way addAttackTarget writes `attacking`; read every tick by Colony's
  // constructor to attach a real Drain operation when set, same pattern as `attacking`.
  draining?: string;
  // Operation-owned observation history of `draining`'s target room — tower energy and storage/room
  // energy samples taken whenever the drain squad has vision of it (issue #40/ADR 0006's "Enemy room
  // snapshot is operation-owned, not general room intel": deliberately NOT folded into ScoutInfo, since
  // this is one operation's tactical log, not general room intel other systems should read or mutate).
  // Scoped to a single target at a time via `room` — switching `draining` to a different room starts a
  // fresh `{ room, samples: [] }` rather than appending to the old target's history (drain.ts owns the
  // reset check). Observability only for now: nothing reads this to drive advance/retreat/spawn
  // decisions (see ADR 0006's consequences — "already positioned to drive this later").
  drainHistory?: { room: string; samples: { tick: number; towerEnergy: number; storageEnergy: number }[] };
  // The single parade this colony is currently marching (sponsoring a formation for), owned by parade.ts —
  // a scalar like `draining` above (one parade per colony at a time). `flag` is the flag name (not a room
  // or a position: Parade's whole point is walking to wherever that flag CURRENTLY sits, which the flag's
  // own room can change as the player drags it — see ColonySnapshot.paradeGoal for the live position read
  // fresh from Game.flags every tick). `formation` is the parsed squad shape ("2x2"/"3x3"/...), fixed at
  // handoff time — resizing an in-progress parade isn't supported; move the flag to a fresh name to
  // restart with a new shape. Written by a flag handoff (empire/paradeFlags.ts's setParadeTarget); read
  // every tick by Colony's constructor to attach a real Parade operation, same pattern as `draining`.
  parading?: { flag: string; formation: string };
  // Every SingleTargetFlagOperation-family operation's durable state (SimpleBaitTower, Demolish,
  // SimpleHeal, AttackController, and any future member — see operations/singleTargetFlagOperation.ts),
  // keyed by operation `kind` then by target room. A scalar like `draining`/`parading` in spirit — this
  // family still only ever expects ONE key per kind in practice, since each flags module refuses a
  // handoff for a target already listed under that kind (see empire/singleTargetFlags.ts) — but keyed by
  // target rather than a bare `kind?: string` scalar so the shape has room for genuine multi-target
  // concurrency later without another Memory migration (see the architecture review this generalized
  // from: Colonize already needs exactly this "N independent instances keyed by target" shape).
  //
  // Written by a flag handoff (setSingleTargetOp) or the operation's own self-termination
  // (clearSingleTargetOp — see that intent's own doc for the one-shot self-end case); read every tick by
  // Colony's constructor to attach one real operation instance per (kind, target) entry.
  singleTargetOps?: Partial<Record<string, Record<string, SingleTargetOpState>>>;
  // The drain squad's own persisted anchor — the formation's bounding box's FIXED top-left corner (see
  // lib/squad.ts's SquadState doc), owned by operations/drain.ts. Seeded once from the live squad's own
  // position at the moment it first welds up (the same live-position derivation the anchor used to be
  // re-derived from every tick, before this field existed), then advanced ONLY by planSquadMove's own
  // returned SquadMovePlan.anchor going forward (a tight-advance step, or a reform's fitting-tile
  // correction) — never re-derived from a live creep's position again in steady state. Written via the
  // setDrainAnchor intent (execute.ts), same pipeline as drainRallyPos above.
  drainAnchor?: SquadAnchorMemory;
  // The parade squad's persisted anchor — identical rule to drainAnchor, owned by operations/parade.ts,
  // written via setParadeAnchor.
  paradeAnchor?: SquadAnchorMemory;
  // Cross-tick cache of hasOutstandingConstruction's own answer (construction/planner.ts), owned by that
  // function alone. Construction sites aren't placed every tick (placeAndDemolish is throttled to
  // interval:100 — see kernel/tick.ts) and a site doesn't finish building every tick either (real
  // builder-tick progress, not a per-tick event this code controls) — so recomputing "is anything still
  // missing" from scratch every tick a colony's own site queue happens to be empty was pure waste once
  // the answer settles to false. `fingerprint` is every cheap-to-read count that can flip the answer
  // (structures/sites/siteSummary lengths, RCL, energy capacity) — see hasOutstandingConstruction's own
  // doc for the exact invalidation rule. Absent means never cached yet (first tick, or a colony that's
  // never reached this path).
  outstandingConstructionCache?: { fingerprint: string; value: boolean };
  // Governed by construction/planner.ts's planBuilding — the FINAL, fully-gated construction plan (the same
  // list placeAndDemolish itself places construction sites from: gateSourceGroups, gateRoads' adjacency
  // gate, substituteBlockedCapped, exit-tile exclusion via the goal layout, everything), with each entry's
  // built/not-yet-built status resolved at write time. This is what the metrics panel's "Buildings" counts
  // are computed from (colony/index.ts's metrics(), via building.ts's buildingRowsFromPlan) and what any
  // other "what's missing and where" consumer should read too — NOT a hand-rolled re-derivation, which
  // silently drifts from the real answer the moment one of those gates changes (confirmed: an earlier
  // ad-hoc script that only replayed buildableAtRcl+stampLayout missed the adjacency/exit-tile/substitution
  // gating entirely and reported wrong tiles as missing). Written once per planBuilding's own interval:100
  // cadence (kernel/tick.ts), never recomputed by a reader: metrics is read-only + math over whatever the
  // capability that actually owns construction governance already produced, the same relationship
  // outstandingConstructionCache above has to hasOutstandingConstruction. Absent only on a colony's first
  // tick before planBuilding has run once, or a colony with no anchor yet (planBuilding returns before
  // writing — see its own early-out).
  buildingPlan?: { type: BuildableStructureConstant; x: number; y: number; room: string; sourceId?: Id<Source>; built: boolean }[];
  // Cached alongside buildingPlan (same write, same interval:100 cadence, same staleness contract) so
  // spawn/bodyContext.ts's body-sizing "roads" flag can ask the planner directly instead of re-deriving
  // road-completion itself from routeBuilt strings. True once energyCapacity has crossed
  // ROADS_FROM_ENERGY_CAPACITY AND no ROAD-type entry in this same buildingPlan write is still unbuilt —
  // the planner's own authoritative claim list, not a parallel scan of colony.remoteSources. Absent only
  // wherever buildingPlan itself is absent (see that field's own doc).
  roadsBuilt?: boolean;
}

// A squad's persisted anchor tile — see ColonyMemory.drainAnchor/paradeAnchor's doc for the full rationale
// (a fixed point the owning operation's own route advances, never re-derived from a live creep every
// tick). Shared shape so both squad-bearing operations use one type rather than two ad hoc duplicates.
export interface SquadAnchorMemory {
  x: number;
  y: number;
  room: string;
}

// A SingleTargetFlagOperation's demand shape (see operations/singleTargetFlagOperation.ts): "oneShot"
// never replaces a dead creep once its slot has been used (SimpleBaitTower's original shape — a slot used
// once, dead or alive, never reopens), "constant" always tops back up to the wanted headcount (Drain/
// Parade's shape — stop only when the flag is removed). Resolved once, from the triggering flag's color,
// at handoff time (empire/flagRequest.ts's lifetimeOf) — never re-read after that, same "flag is a live
// on/off switch, not a live config panel" rule Parade's formation string already follows.
export type OperationLifetime = "oneShot" | "constant";

// One SingleTargetFlagOperation instance's durable state — see ColonyMemory.singleTargetOps's doc for the
// (kind, target) keying this lives under.
export interface SingleTargetOpState {
  // The originating flag's NAME (not a resolved position) — lets the owning *Flags.ts pass tie this
  // entry's lifetime to its one originating flag in both directions, same shape every predecessor
  // (simpleBaitTowerFlag, demolishFlag, ...) used individually. Optional only for the same same-tick-
  // handoff-hasn't-mirrored-yet reason those fields were.
  flag?: string;
  // Resolved once at handoff from the flag's color (see OperationLifetime's doc) — never re-derived.
  lifetime: OperationLifetime;
  // How many creeps this run wants in total — an explicit "<kind>:<room>:<n>" flag suffix, default 1.
  // Meaningful for both lifetimes: a "constant" op tops back up to `wanted` forever, a "oneShot" op stops
  // once `wanted` slots have ever been used (see `spawnedCount` below). Reset to 0 (alongside
  // `spawnedCount`) by a "oneShot" instance's own self-termination (the endSingleTargetOp intent) — the
  // operation's job is done, but the entry (and its `flag`) is deliberately left in place for one more
  // tick so empire/singleTargetFlags.ts's reconciliation pass can still find the flag name to remove the
  // now-orphaned physical flag. `wanted <= 0` therefore reads as "don't attach an instance for this entry"
  // exactly like the entry being absent — Colony's constructor and the base class's desiredCreeps both
  // treat the two the same way.
  wanted: number;
  // Running count of creeps ever spawned so far for this entry (not currently-alive count — a dead one
  // still counts). Only meaningful while lifetime === "oneShot" (kept at 0 and ignored for "constant",
  // which tops up against live count instead) — distinguishes "still below `wanted`, keep requesting"
  // from "hit the quota, stop" even across deaths, so a one-shot slot never reopens once used.
  spawnedCount: number;
}

// One remote room we've chosen to mine, cached in ColonyMemory so selection is stable and not re-ranked
// every tick. Written by the pickRemotes selector (throttled), read by the snapshot builder to fill
// ColonySnapshot.remoteSources.
export interface RemoteMemory {
  room: string;
  sources: RemoteSourceMemory[]; // the sources selected for mining in this room (a room may have unmined far sources)
  reserved: boolean; // are we currently reserving it (recomputed, cached to avoid thrash)
  // Game.time until which the room should still be treated as dangerous, even without current vision.
  // Set from the last-seen hostiles' own ticksToLive (see remoteRoomVision), so a room stays flagged for
  // exactly as long as the invader that chased our vision away is expected to still be standing in it —
  // not forever, and not reset to "safe" the instant the creep that saw it dies. Absent/past means safe.
  dangerUntil?: number;
  // Username currently holding the controller reservation, when it isn't us — e.g. "Invader" after a
  // STRUCTURE_INVADER_CORE reserves it, or another player. Absent means unreserved OR reserved by us
  // (see remoteRoomVision's `reserved` field for that case); never our own username. Unlike dangerUntil,
  // a reservation doesn't decay on its own — this persists across vision loss until the room is next
  // seen with no foreign reservation.
  reservedBy?: string;
}

// A selected remote source and the facts about it that survive across ticks without vision. Live per-tick
// fields (container energy, hostiles) are not stored here — the snapshot builder fills those only when a
// creep gives us vision of the remote room that tick.
export interface RemoteSourceMemory {
  id: Id<Source>;
  x: number;
  y: number;
  distance: number; // route length home->source, computed once at selection time (see mining/distance.ts)
  containerId?: Id<StructureContainer>;
  spot?: { x: number; y: number }; // mining position, recorded like a local source's
  // Copy of the source's own cached route (see ScoutedSource.route below), so the snapshot's remote
  // join only ever reads ColonyMemory and never reaches into Memory.rooms directly — same reasoning
  // that already justifies caching `distance` here instead of re-deriving it from the source's record.
  route?: RemoteRouteTile[];
  // One char per route[] tile ("1" = confirmed built, "0"/absent = not yet confirmed), index-aligned
  // with route. A tile is confirmed the first time its room has live vision AND a road actually stands
  // there — see mining.ts's structures(), which claims every route tile regardless of vision (a claim
  // must survive a vision gap), but building.ts's builtAt() only trusts live colony.remoteStructures,
  // which goes empty for any room with no creep in it right now (including a room the route merely
  // transits through, never mined itself — remoteStructures is keyed off selected source rooms only).
  // Without this, a transit-room road that's already built gets re-claimed and re-placed forever the
  // instant nobody's standing in that room, permanently burning that tick's construction budget on a
  // guaranteed ERR_INVALID_TARGET (confirmed live on W47N14 2026-08-11: an already-built W46N14 corridor
  // ate all 20 remote placeSite slots, starving every actually-unbuilt remote road/container of a turn).
  // Append-only, same rule containerId/spot follow: a road later destroyed is a Repair concern (reads
  // live hits), not something this should silently forget and start re-placing over.
  routeBuilt?: string;
}

// One tile of a cached home->remote-source path, tagged with the room it's in — a path can cross
// several rooms (home, transit, the remote room itself), and construction claims need to know which
// room each tile belongs to.
export interface RemoteRouteTile {
  room: string;
  x: number;
  y: number;
}

// A room-by-room route and how far along it the creep is; `index` is the next room to enter.
export interface RouteMemory {
  dest: string; // guard against walking a stale route to elsewhere
  rooms: string[]; // ordered rooms to pass through, excluding the start
  index: number;
}

export interface SourceMemory {
  containerId?: Id<StructureContainer>;
  linkId?: Id<StructureLink>;
  spot?: { x: number; y: number }; // mining position
}

export interface LinkNetworkMemory {
  storage?: Id<StructureLink>;
  controller?: Id<StructureLink>;
  sources: Id<StructureLink>[];
}

// One room as scouting last observed it. `type` is stored despite being derivable from the name, as a cheap pre-filter;
// an unvisited room carries its type with `tick` absent to mark it never actually seen.
export interface ScoutInfo {
  tick?: number; // Game.time when last physically seen; absent means classified-but-unvisited
  type: RoomType;
  sources: ScoutedSource[]; // the headline remote-mining input — id and position of each source
  mineral?: MineralConstant; // the room's mineral, if any (normal/keeper rooms)
  owner?: string; // controller owner's/reserver's username, including the "Invader" NPC
  // Owned or reserved by another real player (not us, not the Invader NPC) — see execute.ts's
  // observeRoom for the exact derivation. An Invader-core reservation leaves this false: that's treated
  // as temporary/contestable (remoteInvaderAttacks.ts), not a permanent avoid signal like a player claim.
  hostile: boolean;
  // Best bunker anchor for this room, if one fits (see construction/stamp.ts) — normal rooms with a
  // controller only. Computed once from terrain+controller+sources, which never change, and kept
  // forever after like `sources`/`mineral`. The headline input for expansion: a room with no anchor
  // can never be colonized.
  anchor?: XY;
  // Whether resolveScoutedAnchor has actually run for this room (true even when it found no fit).
  // Without this, `anchor === undefined` is ambiguous between "no controller, never attempted" and
  // "has a controller, terrain rejected every candidate" — a colonization picker needs to tell those
  // apart (the latter is a real, permanent "no" for this room; the former just means check `type`
  // instead). Absent/false on any record from before this field existed.
  anchorChecked?: boolean;
  // Pure map-topology colonization score for this room as a potential anchor: the summed
  // remotePotential/keeperPotential (see mining/remotePotentialTable.ts, mining/keeperPotentialTable.ts)
  // of every room within MAX_REMOTE_HOPS, split by normal-vs-keeper since keeper-room mining isn't a
  // built capability yet (see keeperPotential's own upkeep — this is reported, not folded into a single
  // number, so an unbuilt capability can't silently dominate a decision made today). Deliberately does
  // NOT factor in any neighbor's current owner/hostile/reservation state — those change over time and are
  // evaluated separately, live, at actual selection time; this field answers only "how good is this
  // room's permanent map position," which — like `anchor` — never changes once computed, so it's
  // computed once and cached forever. Requires every room within range to already have its own ScoutInfo
  // (source counts, room type) on record — see `potentialChecked` for whether that precondition has been
  // met yet.
  potential?: ColonizationPotential;
  // Whether resolvePotential has actually run for this room (true even if every neighbor scored 0).
  // Unlike anchorChecked, this can't always be computed the moment a room is first scouted — it needs
  // every room within MAX_REMOTE_HOPS to already carry its own ScoutInfo, and the scouting frontier grows
  // outward gradually, so a neighbor may simply not be scouted yet. False/absent means "not attempted,
  // OR attempted but the neighborhood wasn't fully scouted yet" — retried on a later scouting pass either
  // way, same as anchorChecked distinguishes "never attempted" from "attempted, no fit" for anchor.
  potentialChecked?: boolean;
  // Negative cache: the tick a scout last failed to path into this room from `home` (Traveler's travelTo
  // came back ERR_NO_PATH — a real PathFinder search with the scout's own vision at the border, not a
  // findRoute/describeExits guess; see remotePath.ts's ScoutedSource.noPathAt for the same pattern applied
  // to source paths). Game.map.findRoute has no concept of constructed walls at all, so a room can be
  // graph-reachable and zone-status-eligible (scoutCandidatesAround already filters the respawn/novice
  // case) yet still be 100% walled off by another player at every shared border. This does NOT exclude the
  // room from scoutTargets/candidate picking — a scout can always reach the exit tile itself (structures
  // can never occupy one, see remotePath.ts's isExitTile) and observes the room fine from there, fulfilling
  // the scouting order even if it can never walk further in. It only marks the room too expensive to use as
  // a transit hop for OTHER routes (see execute.ts's dangerRouteCost), so a real border wall can't keep
  // getting rediscovered by every route that happens to cross it.
  noPathFrom?: Partial<Record<string, number>>;
  // Negative cache: the tick one of our creeps was last destroyed in this room while it carried a
  // reputation-flagged hostile/dangerous owner (see kernel/hostileActions.ts's scan, memory/reputation.ts).
  // Unlike noPathFrom, there is no exit-tile fallback here — a room that kills on contact means a scout
  // dispatched there dies before it can observe anything, so this DOES exclude the room as a scout
  // destination outright (scoutCandidatesAround), not merely as a transit hop. A room can be graph- and
  // wall-reachable (dangerRouteCost only detours around a hostile owner, never refuses to enter one) yet
  // still be lethal on arrival if it's towered — this is the only signal that catches that case. Same
  // backoff-retry shape as noPathFrom (NO_PATH_RETRY_AFTER) rather than a forever-cache, since towers can
  // be destroyed or the room can change hands.
  lethalAt?: number;
  // A STRUCTURE_INVADER_CORE last seen standing in this room — absent means none was present at the
  // last observation (`tick`). Unlike owner/hostile (controller-derived), a core sits independent of any
  // controller, so this is its own field. `level` 0 is a plain remote-mining-room core (see
  // mining/remoteSources.ts's INVADER_USERNAME reservation, remoteInvaderAttacks.ts clears these); 1-5
  // is a Stronghold's fortified core (ramparted, deploys defenders — not a target this bot can clear,
  // see remoteInvaderAttacks.ts's own doc). `ticksToDeploy` mirrors StructureInvaderCore.ticksToDeploy,
  // present only before deployment. `collapseTicksRemaining` mirrors the core's own EFFECT_COLLAPSE_TIMER
  // effect (RoomObject.effects — see docs.screeps.com/invaders.html), present only once deployed: the
  // real, live decay countdown until the stronghold collapses. The two are mutually exclusive in
  // practice (pre- vs post-deployment); both are simply whatever the last observation saw, each
  // projectable forward from `tick` the same way.
  invaderCore?: { level: number; ticksToDeploy?: number; collapseTicksRemaining?: number };
}

// The two topology-only colonization numbers for one room, plus the extra keeper minerals reachable if
// keeper-room mining existed. See ScoutInfo.potential's doc for what these do and don't account for.
export interface ColonizationPotential {
  normal: number; // avg net energy/tick from unowned normal-room neighbors within MAX_REMOTE_HOPS
  keeper: number; // same, from keeper-room neighbors — informational only; keeper mining isn't built yet
  keeperMinerals: MineralConstant[]; // distinct minerals available across those keeper-room neighbors
}

// A source as seen from outside its room, before any colony claims it for mining.
export interface ScoutedSource {
  id: Id<Source>;
  x: number;
  y: number;
  // Real PathFinder path from a home room's anchor to this source, serialized (one direction digit per
  // tile, Traveler-style — see src/lib/remotePath.ts), keyed by that home room's name. Computed once, at
  // remote-selection time, and kept forever after: a source's position and a home's anchor never move,
  // so neither does the answer. Lives here (not ColonyMemory) because it's the *source*'s fact, not the
  // colony's — a second colony scouting the same room reuses nothing of a first colony's anchor-relative
  // path, but the cache still only ever needs one entry per home that has actually computed it.
  paths?: Partial<Record<string, string>>;
  // The same cached path as `paths`, as a room-tagged tile list instead of a direction-digit string —
  // the shape construction claims need (a claim must know which room a tile is in), computed at the same
  // time from the same PathFinder result so there's never a second path-finding call. Kept alongside
  // `paths` rather than replacing it, since nothing has ever needed to decode the digit string back into
  // positions (see remote-mining-progress/construction plan) and duplicating a small cache is cheaper
  // than risking that decode (cross-room direction math is exactly what broke scout-ping-pong before).
  route?: Partial<Record<string, RemoteRouteTile[]>>;
  // Negative cache: the tick a PathFinder search from this home last came back incomplete (no route —
  // e.g. terrain/vision blocks every crossing). Without this, a genuinely unreachable source has no way
  // to ever get marked "already tried" the way a successful search marks itself via `paths`/`route`, so
  // scouting/pathPrecompute would re-run the same failing PathFinder.search every tick forever. Bounded
  // backoff (see NO_PATH_RETRY_AFTER in lib/remotePath.ts) rather than permanent, so a route that opens
  // up later (new vision, a wall that was actually just unexplored terrain) is retried eventually.
  noPathAt?: Partial<Record<string, number>>;
}

// How far out the frontier has pushed — the one piece of scouting state a tick cannot rederive. The todo list itself
// is recomputed every tick from the room graph, never stored.
export interface ScoutingMemory {
  radius: number; // current scouting radius in rooms; grows toward MAX_SCOUT_RANGE
}

export interface ExpansionMemory {
  version: number;
}

export interface StatsMemory {
  version: number;
  cpu?: Record<string, number>; // last tick's CPU per kernel system name, written by kernel/stats.ts
  bucket?: number; // Game.cpu.bucket at tick end, written by kernel/stats.ts's flush()
  // Short git commit hash of the deployed build (rollup-substituted __GIT_COMMIT__) — lets a Grafana
  // panel/annotation correlate a metric shift with the commit that caused it, since this project
  // doesn't tag releases/versions otherwise.
  commit?: string;
  // Per-room economy gauges for the Grafana forward, one entry per owned colony — point-in-time levels
  // only (no pre-computed rates); Grafana derives rates/deltas itself. Mirrors fields colony/index.ts's
  // metrics() already computes as ColonyMetrics for the in-game panel, so this never re-derives from
  // Game.* directly — see collectMetrics in colony/metrics.ts.
  rooms?: Record<string, RoomStats>;
}

export interface RoomStats {
  energyAvailable: number;
  energyCapacity: number;
  storageEnergy: number;
  spawnLoad: number;
  controllerLevel: number;
  controllerProgress: number;
  controllerProgressTotal: number;
  // Role -> alive count and operation-reported target, mirrors ColonyMetrics.census (colony/metrics.ts).
  census: Record<string, { current: number; desired: number }>;
  // Structure type -> built count and current plan target, mirrors ColonyMetrics.buildings.
  buildings: Record<string, { built: number; targeted: number }>;
  // Distinct rooms among this colony's currently-selected remote sources (snapshot.remoteSources).
  numRemotes: number;
}

// A short window of (tick, total source energy) samples; harvest rate is diffed oldest-vs-newest. A ring rather than a
// running total so a gap in vision self-heals instead of poisoning the average forever.
export interface ColonyMetricsMemory {
  harvestSamples: { tick: number; sourceEnergy: number }[]; // oldest first, capped at HARVEST_WINDOW entries
}

export interface MarketMemory {
  tick: number; // Game.time this snapshot was taken
  // Latest day with valid price data per resource (days with no trades can carry null/NaN stats,
  // which summarizeMarketHistory skips rather than recording).
  prices: Partial<Record<MarketResourceConstant, { date: string; avgPrice: number; stddevPrice: number }>>;
}
