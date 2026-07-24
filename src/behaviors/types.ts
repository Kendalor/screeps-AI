import type { RoleName } from "../memory/schema";

// How many creeps may share one resolved target: "allow"/absent = unlimited, "avoid" = exclusive (1), a number = that many.
// Sources ignore this and use their open harvest-tile count as the cap instead.
export type Share = "allow" | "avoid" | number;

// Breaks the tie deterministically when room.find()'s unspecified order would otherwise decide —
// either as the pool[0] fallback (no reachable path) or among several candidates equidistant by path.
// "largest" ranks a drop pile by its amount; "mostProgress" ranks a construction site closest to done.
export type Prefer = "largest" | "mostProgress";

export type TargetSpec =
  | { find: "structure"; type: StructureConstant; where?: "notFull" | "hasEnergy" | "damaged"; share?: Share }
  | { find: "dropped"; share?: Share; prefer?: "largest" }
  | { find: "tombstone"; share?: Share }
  | { find: "source" }
  | { find: "constructionSite"; share?: Share; prefer?: "mostProgress" }
  | { find: "controller" }
  // A friendly creep, filtered by role. Lets haulers hand energy directly to consumers (upgraders,
  // builders) when the fixed sinks are full, and lets those consumers pull from a hauler instead of
  // chasing scattered drops. `where` reads the creep's store the same way it reads a structure's:
  // "notFull" (has room to receive), "hasEnergy" (has energy to give).
  | { find: "creep"; role: RoleName | RoleName[]; where?: "notFull" | "hasEnergy"; share?: Share }
  | { find: "id"; id: Id<_HasId> };

// A precondition on the CREEP's own store, distinct from a target's `where`: the step only runs
// when the actor's store is in this state. "empty" gates a gather step so a still-loaded hauler
// skips picking up more and cycles back to deliver its current load first ("deliver until empty,
// only pick up when empty"). Absent = the step runs whenever the interpreter's kind-logic allows.
export type When = "empty";

export type Step = ({
  when?: When;
}) &
  (
    | { do: "harvest"; from: TargetSpec }
    | { do: "withdraw"; from: TargetSpec; resource?: ResourceConstant }
    | { do: "pickup"; from: TargetSpec }
    | { do: "transfer"; to: TargetSpec; resource?: ResourceConstant }
    | { do: "build"; at?: TargetSpec }
    | { do: "repair"; at: TargetSpec; upTo?: number }
    | { do: "upgrade" }
    // Move to another room. A static `room` names a fixed destination; `to: "scoutTarget"` reads the
    // destination from creep memory (written by the setScoutTarget intent) and walks the precomputed
    // `memory.route` room by room, so a distant target is crossed the way findRoute planned it rather
    // than by one greedy travelTo. The step is complete when the creep is in the destination room.
    | { do: "moveToRoom"; room?: string; to?: "scoutTarget" }
    | { do: "sit"; pos: { x: number; y: number } } // for the anchor logistics sitter
  );

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
