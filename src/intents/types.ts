// Intent union: planners return these; only intents/execute.ts turns them into game API calls.

export type Intent =
  | { kind: "towerAttack"; tower: Id<StructureTower>; target: Id<Creep> }
  | { kind: "towerHeal"; tower: Id<StructureTower>; target: Id<Creep> }
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
  | { kind: "recordScout"; room: string }
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
