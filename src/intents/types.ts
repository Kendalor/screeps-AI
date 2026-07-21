// Intent union: planners return these; only intents/execute.ts turns them into game API calls.

import type { RoleName } from "../memory/schema";

export type Intent =
  | { kind: "towerAttack"; tower: Id<StructureTower>; target: Id<Creep> }
  | { kind: "towerHeal"; tower: Id<StructureTower>; target: Id<Creep> }
  | { kind: "safeMode"; room: string }
  | {
      kind: "spawn";
      spawn: Id<StructureSpawn>;
      role: RoleName;
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
  | { kind: "marketDeal"; order: string; amount: number; room: string }
  | { kind: "marketOrder"; room: string; resource: ResourceConstant; amount: number; price: number };
