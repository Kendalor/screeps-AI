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
  // A scout recording what it currently stands in. The room name is carried explicitly rather than
  // read from the creep, so the actuator stays a pure Memory write with no Game lookup.
  | { kind: "recordScout"; room: string; info: import("../memory/schema").ScoutInfo }
  | { kind: "marketDeal"; order: string; amount: number; room: string }
  | { kind: "marketOrder"; room: string; resource: ResourceConstant; amount: number; price: number }
  // A batch of drawing primitives for one room's RoomVisual. The planner decides *what* the panel
  // says and where; execute.ts is the only place a RoomVisual is touched, so metric collection stays
  // pure and testable. Ops are drawn in order, so later ones paint over earlier ones.
  | { kind: "roomVisual"; room: string; ops: VisualOp[] };

// The subset of RoomVisual drawing a metrics panel needs. Plain data so a planner can emit it and a
// test can assert on it without a live RoomVisual.
export type VisualOp =
  | { op: "text"; text: string; x: number; y: number; color?: string; align?: "left" | "center" | "right"; size?: number }
  | { op: "rect"; x: number; y: number; w: number; h: number; fill?: string; opacity?: number };
