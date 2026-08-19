// Intent union: planners return these; only intents/execute.ts turns them into game API calls.

import type { OperationLifetime, RoleName, RemoteMemory, SquadAnchorMemory } from "../memory/schema";
import type { XY } from "../lib/geometry";

export type Intent =
  | { kind: "towerAttack"; tower: Id<StructureTower>; target: Id<Creep> }
  | { kind: "towerHeal"; tower: Id<StructureTower>; target: Id<Creep> }
  | { kind: "towerRepair"; tower: Id<StructureTower>; target: Id<Structure> }
  | { kind: "safeMode"; room: string }
  | {
      // No top-level role: memory.role is ground truth, and a second carrier would have nothing enforcing agreement.
      kind: "spawn";
      spawn: Id<StructureSpawn>;
      body: BodyPartConstant[];
      memory: CreepMemory;
      dir?: DirectionConstant;
    }
  | { kind: "linkSend"; from: Id<StructureLink>; to: Id<StructureLink> }
  | { kind: "placeSite"; room: string; x: number; y: number; type: BuildableStructureConstant }
  // Repurpose a live creep in place — an idle builder with no construction left becomes a repairer or
  // upgrader instead of drop-mining out its remaining life. execute.ts owns the memory.role write.
  // `op` is the new role's owning operation stamp (see spawn/request.ts's opName) — required, not
  // cleared to undefined: Operation.owned()'s op-less fallback treats an unstamped creep as ownable by
  // *every* operation, so every operation with no roleTargets override would double-count it.
  | { kind: "setCreepRole"; creep: Id<Creep>; role: RoleName; op: string }
  // A builder's cross-room construction assignment — picked by operations/construction.ts off siteSummary
  // (already vision-independent, room-name-only distance ranking), so unlike setScoutTarget the room is
  // resolved in the planner itself; execute.ts just writes it. See CreepMemory.buildTargetRoom.
  | { kind: "setBuildTargetRoom"; creep: Id<Creep>; room: string }
  // The repairer equivalent, picked by operations/repairing.ts off tower-uncovered decay across the
  // colony's rooms. See CreepMemory.repairTargetRoom.
  | { kind: "setRepairTargetRoom"; creep: Id<Creep>; room: string }
  // The defender equivalent, picked by operations/defense.ts off whichever rooms (home or remote) currently
  // have hostiles. See CreepMemory.defendTargetRoom.
  | { kind: "setDefendTargetRoom"; creep: Id<Creep>; room: string }
  // The attacker equivalent, picked by operations/attack.ts off whichever room in ColonyMemory.attacking
  // the creep isn't already assigned to. See CreepMemory.attackTargetRoom.
  | { kind: "setAttackTargetRoom"; creep: Id<Creep>; room: string }
  // A drain squad member's rally destination TILE (not a room — see CreepMemory.drainRallyPos and
  // behaviors/types.ts's moveToPos step), picked by operations/drain.ts off the squad's live anchor tile
  // (or the staging room center pre-assembly). Room-membership rallying let two stragglers converging on
  // each other's CURRENT room chase each other across a border forever; a real tile fixes that.
  | { kind: "setDrainRallyPos"; creep: Id<Creep>; pos: XY & { room: string } }
  // The parade equivalent of setDrainRallyPos, for ParadeMember's own moveToPos step. See
  // CreepMemory.paradeRallyPos.
  | { kind: "setParadeRallyPos"; creep: Id<Creep>; pos: XY & { room: string } }
  // Stateful squad membership (see CreepMemory.squadJoined): a creep joins ONE NAMED squad (`op`, the same
  // opName stamp as CreepMemory.op — e.g. "drain:W1N1") once — when it first comes within the formation's
  // own footprint of that squad's anchor — and STAYS joined (skipping its own step table, driven by
  // runSquads instead) until explicitly cleared, rather than membership being re-derived from live position
  // fresh every tick. `op` disambiguates WHICH squad: a bare joined/not-joined flag would be meaningless
  // once more than one squad-bearing operation exists. Fixes a border-crossing flicker: a formation
  // legitimately straddles two rooms for a tile or two mid-crossing, and any purely-positional membership
  // test can (and, confirmed live, did) flip a straddling member in and out of the plan tick to tick even
  // though nothing about whether it belongs actually changed.
  | { kind: "setSquadJoined"; creep: Id<Creep>; op: string }
  | { kind: "clearSquadJoined"; creep: Id<Creep> }
  | { kind: "removeStructure"; room: string; x: number; y: number; type: BuildableStructureConstant }
  // Persists which built link plays which role in the colony's link network — the equivalent of
  // recordSourceSpot's linkId, but for the two links that aren't source-side (Mining already records
  // those directly on sourceMemory). Only ever adds an id, same non-destructive rule. Emitted by
  // whichever operation owns that link's placement: Logistics for the anchor/storage link (see
  // logistics/links.ts), Upgrading for the controller link (see operations/upgrading.ts).
  | { kind: "recordLinkNetwork"; room: string; storage?: Id<StructureLink>; controller?: Id<StructureLink> }
  | {
      kind: "recordSourceSpot";
      room: string;
      source: Id<Source>;
      spot: { x: number; y: number };
      container?: Id<StructureContainer>;
      link?: Id<StructureLink>;
    }
  // The remote-route equivalent of recordSourceSpot, for the one field a remote source actually needs
  // persisted (see RemoteSourceMemory.containerId — spot/route are already cached elsewhere). A separate
  // kind rather than reusing recordSourceSpot: that one writes ColonyMemory.sources (flat, local-only),
  // while this writes ColonyMemory.remotes[].sources[] (nested under the selected remote room).
  | { kind: "recordRemoteContainer"; room: string; remoteRoom: string; source: Id<Source>; container: Id<StructureContainer> }
  // Persists which of a remote source's route tiles are confirmed built (see RemoteSourceMemory.routeBuilt's
  // doc) — the road equivalent of recordRemoteContainer above. `index` is the tile's position in that
  // source's route[] array; execute.ts flips routeBuilt's character at that index from "0" to "1".
  // Append-only per index, same non-destructive rule as recordRemoteContainer.
  | { kind: "recordRemoteRouteBuilt"; room: string; remoteRoom: string; source: Id<Source>; index: number }
  // Persists a remote room's live danger read (see RemoteRoomVision.dangerUntil) so it survives losing
  // vision — execute.ts writes it onto ColonyMemory.remotes[].dangerUntil. Unlike recordRemoteContainer
  // this can move the value down (to undefined) as well as up: it's only ever emitted when vision exists,
  // so an all-clear read is just as much ground truth as a hostile one.
  // `reservedBy`: same move-down-as-well-as-up rule as dangerUntil above — captured from the same vision
  // read at the same call site, so both are always emitted (or not) together.
  | { kind: "recordRemoteDanger"; room: string; remoteRoom: string; dangerUntil: number | undefined; reservedBy: string | undefined }
  // Persists the room's mineral deposit's regeneration deadline (Game.time + ticksToRegeneration at the
  // observing tick) so a depleted deposit's status survives losing vision — see MineralMemory's own doc
  // (memory/schema.ts) for why this can't just be read live every tick the way a home-room source can.
  // Unlike recordSourceSpot's ids, this DOES move down (cleared once regen completes on a tick with
  // vision) — a stale "still regenerating" read would otherwise block mineralMiner requests forever once
  // vision is lost mid-regen and never regained before the real deadline passes.
  | { kind: "recordMineralRegen"; room: string; regeneratesAt: number | undefined }
  // Planner decides a room is worth recording; execute.ts reads the live room to build the observation.
  // `passive`: recorded from ambient vision, not a scout's assigned survey — execute.ts skips re-finding
  // static data (sources/mineral) already on record, refreshing only tick/owner/hostile.
  | { kind: "recordScout"; room: string; passive?: boolean }
  // Invalidates a room's scout record staleness (without discarding the data itself) so the next
  // Scouting pass treats it as due for a re-survey regardless of its normal/invader-owned interval.
  // Emitted by remoteInvaderAttacks.ts the moment a live core is confirmed: a core's neighbourhood needs
  // eyes back on it promptly, not whenever the ordinary staleness clock happens to expire (see
  // remoteInvaderAttacks.ts's header for why an unmined neighbour left unscouted can silently hide a
  // core for a full staleAfter interval). No-ops on a room with no ScoutInfo yet - nothing to invalidate.
  | { kind: "forceRescout"; room: string }
  // Precomputes and caches a scouted source's real home->source PathFinder distance (see
  // ScoutedSource.paths/.route) before pickRemotes ever runs, so selection ranks/prices sources on the
  // ground truth instead of the cheap remoteDistanceEstimate fallback. Emitted for scouted sources within
  // MAX_REMOTE_HOPS that don't have a cached path yet; execute.ts owns the actual PathFinder call and
  // Memory write via the same resolvePathToSource helper resolveRemoteRoom already uses post-selection.
  | { kind: "recordSourcePath"; home: string; room: string; anchor: { x: number; y: number }; source: Id<Source> }
  // Precomputes and caches a scouted room's ColonizationPotential (see memory/schema.ts's ScoutInfo.potential/
  // potentialChecked) — the pure map-topology colonization score, summed over the room's own neighborhood.
  // Emitted for any scouted room lacking potentialChecked; execute.ts does the Game.map.describeExits BFS
  // (scoutCandidatesAround, rooted at `room` itself rather than a colony's home) since only it can reach
  // Game.map, then only writes/marks-checked once every room in that BFS is itself already scouted — see
  // summarizeNeighborhoodPotential.ts's neighborhoodFullyScouted for why a partially-scouted neighborhood can't be
  // trusted yet.
  | { kind: "recordPotential"; room: string }
  // Planner narrows each idle scout to its own viable candidate rooms (pure filter, no distance
  // ranking); bundled one intent per colony (not per scout) so execute.ts can assign all of them
  // together via greedy nearest-pair matching over real Game.map.findRoute hop counts, instead of each
  // scout picking its own nearest independently — the latter sends every idle scout to the same room
  // whenever their pools overlap, since they all agree on which candidate is nearest. Writes target +
  // route into creep memory per assigned scout.
  | { kind: "setScoutTargets"; assignments: { creep: Id<Creep>; candidates: string[] }[] }
  // Emitted when the current scouting radius is fully surveyed; execute.ts owns the Memory write and cap.
  | { kind: "advanceScoutRadius" }
  // pickRemotes decides which remote rooms/sources to mine (throttled); execute.ts owns the
  // Memory.colonies[room].remotes write. The cached selection the snapshot builder reads back. `strikes`
  // is pickRemotes' eviction-hysteresis bookkeeping (see PickRemotesResult) — execute.ts owns the
  // Memory.colonies[room].remoteStrikes write, same as remotes.
  | { kind: "setRemotes"; room: string; remotes: RemoteMemory[]; strikes: Record<Id<Source>, number> }
  // A flag/auto-pick handoff resolved `room` as the sponsor for colonizing `target` — execute.ts owns
  // the Memory.colonies[room].colonizing write (append, deduped). From the next tick on, Colony's
  // constructor reads it back to attach a real Colonize operation, same as setRemotes above. `flag`, when
  // the handoff came from a live flag (colonizeFlags.ts) rather than the auto-picker
  // (pickColonyTargets.ts), records that flag's name into ColonyMemory.colonizingFlags so the target's
  // lifetime can be tied back to it — see that field's doc.
  | { kind: "addColonizeTarget"; room: string; target: string; flag?: string }
  // Colonize.intents() owns removal: the target either finished (reached SELF_SUFFICIENT_ENERGY_CAP) or
  // failed permanently (terminal claimController error) — see colonize.ts for the exact condition.
  // execute.ts also prunes any colonizingFlags entry for this target, but deliberately does NOT remove
  // the flag itself from Game.flags — that's colonizeFlags.ts's job (it owns the only Game.flags mutation
  // for this operation), reading the now-orphaned memory entry back on its next pass. See that file's header.
  | { kind: "removeColonizeTarget"; room: string; target: string }
  // The combat equivalent of addColonizeTarget: a flag handoff resolved `room` as the sponsor for
  // attacking `target` — execute.ts owns the Memory.colonies[room].attacking write (append, deduped).
  // `flag`, same meaning/purpose as addColonizeTarget's — omitted by remoteInvaderAttacks.ts's auto-pick.
  | { kind: "addAttackTarget"; room: string; target: string; flag?: string }
  // Attack.intents() owns removal: the target room has been seen with zero hostile creeps left — see
  // attack.ts for the exact condition. Same attackingFlags-pruning/flag-removal split as removeColonizeTarget.
  | { kind: "removeAttackTarget"; room: string; target: string }
  // The defensive equivalent of addAttackTarget/removeAttackTarget: a flag handoff resolved `room` as the
  // sponsor for defending `target` (a room outside its own home/remotes) — execute.ts owns the
  // Memory.colonies[room].defending write (append, deduped). `flag`, same meaning/purpose as above.
  | { kind: "addDefendTarget"; room: string; target: string; flag?: string }
  // Defense.intents() owns removal: the target room has been seen with zero hostile creeps left — same
  // condition as removeAttackTarget, see defense.ts. Same defendingFlags-pruning/flag-removal split.
  | { kind: "removeDefendTarget"; room: string; target: string }
  // The drain equivalent of addAttackTarget: a flag handoff resolved `room` as the sponsor for draining
  // `target` — execute.ts owns the Memory.colonies[room].draining write. Unlike addAttackTarget this is a
  // plain overwrite, not an append: ColonyMemory.draining is a scalar (ADR 0006's exactly-one-drain-
  // target-per-colony), so there's no list to dedupe into and no separate remove intent needed — setting
  // the same target again is just a harmless no-op overwrite.
  | { kind: "setDrainTarget"; room: string; target: string }
  // Manual CLI-driven stop (see commands/console.ts's clearDrainTarget) — clears ColonyMemory.draining so
  // Colony's constructor stops attaching a Drain operation for that colony from the next tick on. No
  // automatic emitter yet (ADR 0006: no automatic end condition in this slice).
  | { kind: "clearDrainTarget"; room: string }
  // The parade equivalent of setDrainTarget/clearDrainTarget: a flag handoff resolved `room` as the
  // sponsor for a marching formation named `flag` at squad shape `formation` ("2x2"/"3x3"/...) — see
  // ColonyMemory.parading. A plain overwrite, not an append, same scalar reasoning as setDrainTarget.
  | { kind: "setParadeTarget"; room: string; flag: string; formation: string }
  // Manual/flag-removal stop: clears ColonyMemory.parading so Colony's constructor stops attaching a
  // Parade operation for that colony from the next tick on.
  | { kind: "clearParadeTarget"; room: string }
  // The SingleTargetFlagOperation-family equivalent of setDrainTarget, generalized across every kind in
  // the family (SimpleBaitTower, Demolish, SimpleHeal, AttackController, ...) instead of one intent
  // variant per kind — a flag handoff resolved `room` as the sponsor for `numCreeps` creeps of this `kind`
  // at `target`. execute.ts owns the ColonyMemory.singleTargetOps[kind][target] write (a plain set, not an
  // append — each (kind, target) pair holds at most one entry). `flag` ties the entry's lifetime to its
  // one originating flag in both directions (see SingleTargetOpState.flag's doc); `lifetime` is resolved
  // once here from the flag's color (empire/flagRequest.ts's lifetimeOf) and never re-derived.
  | { kind: "setSingleTargetOp"; room: string; opKind: string; target: string; flag: string; lifetime: OperationLifetime; numCreeps: number }
  // Manual/flag-removal stop: clears ColonyMemory.singleTargetOps[opKind][target] entirely (there's no
  // flag left to clean up — it's already gone) so Colony's constructor stops attaching that operation
  // instance from the next tick on. Emitted by empire/singleTargetFlags.ts once a colony's tracked flag is
  // no longer live, and by the removeOperation console command.
  | { kind: "clearSingleTargetOp"; room: string; opKind: string; target: string }
  // Self-termination: a SingleTargetFlagOperation instance's own end-of-life signal for a "oneShot"
  // lifetime entry (every wanted creep has been spawned at least once and none are left alive — see
  // operations/singleTargetFlagOperation.ts), emitted from its own intents(). Deliberately narrower than
  // clearSingleTargetOp: it resets the entry's `wanted`/`spawnedCount` to 0 (so Colony's constructor stops
  // attaching an instance for it — see SingleTargetOpState.wanted's doc) but leaves the entry itself, and
  // its `flag`, standing for one more tick — execute.ts intent handlers never touch Game.flags, so the
  // physical flag still needs removing, and empire/singleTargetFlags.ts's own reconciliation pass (which
  // runs on a LATER tick) needs the flag name still on record to find and remove the now-orphaned flag,
  // then clears the entry fully via clearSingleTargetOp once that's done.
  | { kind: "endSingleTargetOp"; room: string; opKind: string; target: string }
  // Running-count increment (see SingleTargetOpState.spawnedCount's doc): emitted by a "oneShot" instance
  // with the number of newly-seen creeps this tick, so a later death reads against how many slots have
  // been used rather than "never spawned" (keep requesting that slot). A no-op write for a "constant"
  // instance (nothing currently emits it in that mode — constant tops up against live count instead).
  | { kind: "recordSingleTargetSpawn"; room: string; opKind: string; target: string; by: number }
  // Drain's per-tick observation sample (#40/ADR 0006's operation-owned snapshot history) — emitted by
  // drain.ts's intents() whenever it has vision of colony.draining's target this tick (same
  // hostileRoomTowers-presence vision check the advance/retreat rule already uses). execute.ts owns the
  // Memory.colonies[room].drainHistory write, including the reset-on-target-switch: if the stored
  // history's `room` doesn't match `target`, it starts a fresh history instead of appending.
  | { kind: "recordDrainSample"; room: string; target: string; tick: number; towerEnergy: number; storageEnergy: number }
  // The drain/parade squad's persisted anchor (see ColonyMemory.drainAnchor/paradeAnchor's doc): the
  // formation's bounding box's FIXED top-left corner, a colony-owned value only the owning operation's own
  // planMove/planSquadMove route may advance or correct — emitted by empire/creeps.ts's runSquads whenever
  // SquadMovePlan.anchor differs from the SquadState it was computed from, and by drain.ts/parade.ts's
  // own intents() at the moment a squad first welds up (seeding the value from the live squad's position).
  | { kind: "setDrainAnchor"; room: string; anchor: SquadAnchorMemory }
  | { kind: "setParadeAnchor"; room: string; anchor: SquadAnchorMemory }
  | { kind: "marketDeal"; order: string; amount: number; room: string }
  | { kind: "marketOrder"; room: string; resource: ResourceConstant; amount: number; price: number }
  // Spends PIXEL_CPU_COST bucket for one pixel — emitted empire-wide (not per-colony) whenever the bucket
  // is full; see empire/pixels.ts.
  | { kind: "generatePixel" }
  // Drawing primitives for one room's RoomVisual; drawn in order so later ops paint over earlier ones.
  | { kind: "roomVisual"; room: string; ops: VisualOp[] };

// The subset of RoomVisual drawing a metrics panel needs, as plain testable data.
export type VisualOp =
  | { op: "text"; text: string; x: number; y: number; color?: string; align?: "left" | "center" | "right"; size?: number }
  | { op: "rect"; x: number; y: number; w: number; h: number; fill?: string; opacity?: number };
