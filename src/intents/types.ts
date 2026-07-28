// Intent union: planners return these; only intents/execute.ts turns them into game API calls.

import type { RoleName } from "../memory/schema";
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
  // Planner decides a room is worth recording; execute.ts reads the live room to build the observation.
  // `passive`: recorded from ambient vision, not a scout's assigned survey — execute.ts skips re-finding
  // static data (sources/mineral) already on record, refreshing only tick/owner/hostile.
  | { kind: "recordScout"; room: string; passive?: boolean }
  // Planner picks the target room; execute.ts computes the route and writes it into creep memory.
  | { kind: "setScoutTarget"; creep: Id<Creep>; targetRoom: string }
  // Emitted when the current scouting radius is fully surveyed; execute.ts owns the Memory write and cap.
  | { kind: "advanceScoutRadius" }
  | { kind: "marketDeal"; order: string; amount: number; room: string }
  | { kind: "marketOrder"; room: string; resource: ResourceConstant; amount: number; price: number }
  // Drawing primitives for one room's RoomVisual; drawn in order so later ops paint over earlier ones.
  | { kind: "roomVisual"; room: string; ops: VisualOp[] };

// The subset of RoomVisual drawing a metrics panel needs, as plain testable data.
export type VisualOp =
  | { op: "text"; text: string; x: number; y: number; color?: string; align?: "left" | "center" | "right"; size?: number }
  | { op: "rect"; x: number; y: number; w: number; h: number; fill?: string; opacity?: number };
