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

export interface RoleDef {
  body: (energy: number) => BodyPartConstant[];
  steps: Step[];
}
