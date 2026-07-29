import type { RoleName } from "../memory/schema";

// How many creeps may share one resolved target: "allow"/absent = unlimited, "avoid" = exclusive (1), a number = that many.
// Sources ignore this and use their open harvest-tile count as the cap instead.
export type Share = "allow" | "avoid" | number;

// Selection strategy a step declares outright, no implicit fallback: "nearest" (default) is closest, "largest" ranks a drop pile by amount, "mostProgress" ranks a construction site closest to done, "mostDamaged" ranks a structure by lowest hits fraction (the repair counterpart of "mostProgress").
export type Prefer = "nearest" | "largest" | "mostProgress" | "mostDamaged";

export type TargetSpec =
  | {
      find: "structure";
      // A single type or a list — a list pools every matching structureType into one candidate set
      // (e.g. STRUCTURE_SPAWN and STRUCTURE_EXTENSION together), same as "any" does across find-kinds.
      type: StructureConstant | StructureConstant[];
      where?: "notFull" | "hasEnergy" | "damaged";
      share?: Share;
      prefer?: Prefer;
      // Positional discriminator, the only way to tell same-typed structures apart by where they sit:
      //  - "assignedSource": range 1 of the creep's memory.sourceId — a miner's own source container/link.
      //  - "controller": range 2 of the room controller — the controller container (an upgrader parked on
      //    it stays in upgrade range). This is the hauler's fill target.
      //  - "notController": the complement — every container that is NOT the controller's, i.e. the source
      //    containers a hauler draws from. Keeps a hauler from draining the very container it fills.
      near?: "assignedSource" | "controller" | "notController";
      // Only qualify a store-holder while its energy fraction is BELOW this (0..1). Lets the hauler top the
      // controller container to a floor (0.7) and then leave it alone, rather than fighting the upgraders
      // that drain it for every last unit. Combines with `where` (both must pass).
      fillTo?: number;
      // Only qualify a structure while its hits fraction is BELOW this (0..1) — the repair counterpart of
      // fillTo. Lets a miner start repairing its container only once it has decayed past a floor (0.7)
      // rather than chasing every point of decay. Combines with `where` (both must pass).
      repairBelow?: number;
    }
  | { find: "dropped"; share?: Share; prefer?: Prefer }
  | { find: "tombstone"; share?: Share; prefer?: Prefer }
  | { find: "source" }
  // structureType/near scope which sites qualify, mirroring the structure spec: a miner builds only the
  // CONTAINER site at its own source, not whatever construction site happens to be nearest.
  | { find: "constructionSite"; structureType?: StructureConstant; near?: "assignedSource" | "controller" | "notController"; share?: Share; prefer?: Prefer }
  | { find: "controller" }
  | { find: "creep"; role: RoleName | RoleName[]; where?: "notFull" | "hasEnergy"; share?: Share; prefer?: Prefer } // friendly creep as source/sink, filtered by role
  | { find: "id"; id: Id<_HasId> }
  // Groups several specs into one pool (e.g. every viable energy sink) so a step picks the nearest
  // across kinds in one shot instead of falling through a priority-ordered chain of single-kind steps.
  // Each member keeps its own where/share/prefer; "any" itself only decides how the merged pool is ranked.
  // Members exclude "any" (no nesting), "id" and "controller" (both singular, not a search pool).
  | { find: "any"; of: Exclude<TargetSpec, { find: "any" | "id" | "controller" }>[]; prefer?: Prefer };

// Precondition on the CREEP's own store (not the target's `where`); "empty" gates a gather step so a loaded hauler delivers first.
export type When = "empty";

export type Step = ({
  when?: When;
  oneShot?: boolean; // complete on first act instead of waiting for store to empty; needed for creep sinks, which never "fill"
}) &
  (
    | { do: "harvest"; from: TargetSpec }
    | { do: "withdraw"; from: TargetSpec; resource?: ResourceConstant }
    | { do: "pickup"; from: TargetSpec }
    // Like withdraw/pickup but picks the right game call per resolved target — a "from" spec (e.g.
    // energySourceGroup()) may resolve to either a dropped Resource (needs pickup) or a store-holder
    // (needs withdraw), and the step shouldn't have to commit to one verb ahead of knowing which.
    | { do: "gather"; from: TargetSpec; resource?: ResourceConstant }
    | { do: "transfer"; to: TargetSpec; resource?: ResourceConstant }
    | { do: "build"; at?: TargetSpec }
    | { do: "repair"; at: TargetSpec; upTo?: number }
    | { do: "upgrade" }
    | { do: "reserve" } // reserve the current room's controller — a claimer's whole job, once it has arrived
    | { do: "moveToRoom"; room?: string; to?: "scoutTarget" | "targetRoom" } // static room, or "scoutTarget"/"targetRoom" to read the destination + memory.route from creep memory
    | { do: "sit"; pos: { x: number; y: number } } // for the anchor logistics sitter
  );

export interface TaskState {
  step: number;
  target?: Id<_HasId>;
}

// What a body calculator may know beyond the energy budget (e.g. container/link presence).
export interface BodyContext {
  hasContainer: boolean;
  hasLink: boolean;
  // A container construction site exists at the source but isn't built yet. Grants a drop-miner one CARRY
  // so it can harvest into its store and help build (and later repair) its own container, rather than
  // dropping everything and standing idle while a builder does all the work.
  hasContainerSite?: boolean;
  roads?: boolean; // whether the creep's route is paved; unused by body calculators today, reserved for MOVE-ratio tuning
}

export interface RoleDef {
  body: (energy: number, ctx: BodyContext) => BodyPartConstant[];
  steps: Step[];
  priority: number;
  // Opt in to opportunistic en-route pickup while travelling to a gather target (behaviors/sweep.ts).
  sweep?: boolean;
}
