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
  | { kind: "setCreepRole"; creep: Id<Creep>; role: RoleName }
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
  // planLogistics decides; execute.ts owns the memory.logistics.current write (same "planner decides,
  // execute.ts owns the memory write" split as setCreepRole above).
  | { kind: "assignLogisticsTask"; creep: Id<Creep>; task: LogisticsTask }
  | { kind: "removeStructure"; room: string; x: number; y: number; type: BuildableStructureConstant }
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
  | { kind: "recordRemoteDanger"; room: string; remoteRoom: string; dangerUntil: number | undefined }
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
  // Planner narrows to the viable candidate rooms (pure filter, no distance ranking); execute.ts picks
  // the nearest by Game.map.findRoute (real room-graph hops from the scout's *current* room, since only
  // it can reach Game.map) and writes the target + route into creep memory.
  | { kind: "setScoutTarget"; creep: Id<Creep>; candidates: string[] }
  // Emitted when the current scouting radius is fully surveyed; execute.ts owns the Memory write and cap.
  | { kind: "advanceScoutRadius" }
  // pickRemotes decides which remote rooms/sources to mine (throttled); execute.ts owns the
  // Memory.colonies[room].remotes write. The cached selection the snapshot builder reads back.
  | { kind: "setRemotes"; room: string; remotes: RemoteMemory[] }
  | { kind: "marketDeal"; order: string; amount: number; room: string }
  | { kind: "marketOrder"; room: string; resource: ResourceConstant; amount: number; price: number }
  // Drawing primitives for one room's RoomVisual; drawn in order so later ops paint over earlier ones.
  | { kind: "roomVisual"; room: string; ops: VisualOp[] };

// The subset of RoomVisual drawing a metrics panel needs, as plain testable data.
export type VisualOp =
  | { op: "text"; text: string; x: number; y: number; color?: string; align?: "left" | "center" | "right"; size?: number }
  | { op: "rect"; x: number; y: number; w: number; h: number; fill?: string; opacity?: number };
