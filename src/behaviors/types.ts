// How many creeps may share one resolved target: "allow"/absent = unlimited, "avoid" = exclusive (1), a number = that many.
// Sources ignore this and use their open harvest-tile count as the cap instead.
export type Share = "allow" | "avoid" | number;

export type TargetSpec =
  | { find: "structure"; type: StructureConstant; where?: "notFull" | "hasEnergy" | "damaged"; share?: Share }
  | { find: "dropped"; share?: Share }
  | { find: "tombstone"; share?: Share }
  | { find: "source" }
  | { find: "constructionSite"; share?: Share }
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
  step: number;
  target?: Id<_HasId>;
}

// What a body calculator may know beyond the energy budget: e.g. a miner needs no CARRY on a container, but does with a link to feed.
export interface BodyContext {
  hasContainer: boolean;
  hasLink: boolean;
}

export interface RoleDef {
  body: (energy: number, ctx: BodyContext) => BodyPartConstant[];
  steps: Step[];
}
