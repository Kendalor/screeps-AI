// Step / Behavior definitions (docs/rewrite-skeleton.md §5).

export type TargetSpec =
  | { find: "structure"; type: StructureConstant; where?: "notFull" | "hasEnergy" | "damaged" }
  | { find: "dropped" }
  | { find: "tombstone" }
  | { find: "source" }
  | { find: "constructionSite" }
  | { find: "controller" }
  | { find: "id"; id: Id<_HasId> };

export type Step =
  | { do: "harvest"; from: TargetSpec }
  | { do: "withdraw"; from: TargetSpec; resource?: ResourceConstant }
  | { do: "pickup"; from: TargetSpec }
  | { do: "transfer"; to: TargetSpec; resource?: ResourceConstant }
  | { do: "build"; at?: TargetSpec }
  | { do: "repair"; at: TargetSpec; upTo?: number }
  | { do: "upgrade" }
  | { do: "moveToRoom"; room: string }
  | { do: "sit"; pos: { x: number; y: number } }; // for the anchor logistics sitter

export interface TaskState {
  step: number; // index into the role's step list
  target?: Id<_HasId>; // locked target for the current step
}

// What a body calculator may know about the colony beyond its energy budget.
// Only roles whose shape genuinely depends on built structures read it: a
// miner standing on a container needs no CARRY, but with no container (early)
// or with a link to feed (late) it must hold energy to hand off.
export interface BodyContext {
  hasContainer: boolean;
  hasLink: boolean;
}

export interface RoleDef {
  body: (energy: number, ctx: BodyContext) => BodyPartConstant[];
  steps: Step[];
}
