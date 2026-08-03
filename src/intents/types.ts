// Intent union: planners return these; only intents/execute.ts turns them into game API calls.

import type { RoleName, RemoteMemory } from "../memory/schema";
import type { LogisticsTask } from "../logistics/types";

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
  // A builder's cross-room construction assignment — picked by operations/building.ts off siteSummary
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
  // planLogistics decides; execute.ts owns the memory.logistics.current write (same "planner decides,
  // execute.ts owns the memory write" split as setCreepRole above).
  | { kind: "assignLogisticsTask"; creep: Id<Creep>; task: LogisticsTask }
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
  // Persists a remote room's live danger read (see RemoteRoomVision.dangerUntil) so it survives losing
  // vision — execute.ts writes it onto ColonyMemory.remotes[].dangerUntil. Unlike recordRemoteContainer
  // this can move the value down (to undefined) as well as up: it's only ever emitted when vision exists,
  // so an all-clear read is just as much ground truth as a hostile one.
  // `reservedBy`: same move-down-as-well-as-up rule as dangerUntil above — captured from the same vision
  // read at the same call site, so both are always emitted (or not) together.
  | { kind: "recordRemoteDanger"; room: string; remoteRoom: string; dangerUntil: number | undefined; reservedBy: string | undefined }
  // Planner decides a room is worth recording; execute.ts reads the live room to build the observation.
  // `passive`: recorded from ambient vision, not a scout's assigned survey — execute.ts skips re-finding
  // static data (sources/mineral) already on record, refreshing only tick/owner/hostile.
  | { kind: "recordScout"; room: string; passive?: boolean }
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
  // colonizationPotential.ts's neighborhoodFullyScouted for why a partially-scouted neighborhood can't be
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
  // Memory.colonies[room].remotes write. The cached selection the snapshot builder reads back.
  | { kind: "setRemotes"; room: string; remotes: RemoteMemory[] }
  // A flag/auto-pick handoff resolved `room` as the sponsor for colonizing `target` — execute.ts owns
  // the Memory.colonies[room].colonizing write (append, deduped). From the next tick on, Colony's
  // constructor reads it back to attach a real Colonize operation, same as setRemotes above.
  | { kind: "addColonizeTarget"; room: string; target: string }
  // Colonize.intents() owns removal: the target either finished (reached SELF_SUFFICIENT_ENERGY_CAP) or
  // failed permanently (terminal claimController error) — see colonize.ts for the exact condition.
  | { kind: "removeColonizeTarget"; room: string; target: string }
  // The combat equivalent of addColonizeTarget: a flag handoff resolved `room` as the sponsor for
  // attacking `target` — execute.ts owns the Memory.colonies[room].attacking write (append, deduped).
  | { kind: "addAttackTarget"; room: string; target: string }
  // Attack.intents() owns removal: the target room has been seen with zero hostile creeps left — see
  // attack.ts for the exact condition.
  | { kind: "removeAttackTarget"; room: string; target: string }
  | { kind: "marketDeal"; order: string; amount: number; room: string }
  | { kind: "marketOrder"; room: string; resource: ResourceConstant; amount: number; price: number }
  // Drawing primitives for one room's RoomVisual; drawn in order so later ops paint over earlier ones.
  | { kind: "roomVisual"; room: string; ops: VisualOp[] };

// The subset of RoomVisual drawing a metrics panel needs, as plain testable data.
export type VisualOp =
  | { op: "text"; text: string; x: number; y: number; color?: string; align?: "left" | "center" | "right"; size?: number }
  | { op: "rect"; x: number; y: number; w: number; h: number; fill?: string; opacity?: number };
