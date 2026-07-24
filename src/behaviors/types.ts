import type { RoleName } from "../memory/schema";

// How many creeps may share one resolved target: "allow"/absent = unlimited, "avoid" = exclusive (1), a number = that many.
// Sources ignore this and use their open harvest-tile count as the cap instead.
export type Share = "allow" | "avoid" | number;

// The selection strategy a step declares outright — there is no implicit fallback search.
// "nearest" (the default when a spec omits `prefer`) asks the path engine for the closest candidate.
// "largest" ranks a drop pile by its amount; "mostProgress" ranks a construction site closest to done.
export type Prefer = "nearest" | "largest" | "mostProgress";

export type TargetSpec =
  | { find: "structure"; type: StructureConstant; where?: "notFull" | "hasEnergy" | "damaged"; share?: Share; prefer?: Prefer }
  | { find: "dropped"; share?: Share; prefer?: Prefer }
  | { find: "tombstone"; share?: Share; prefer?: Prefer }
  | { find: "source" }
  | { find: "constructionSite"; share?: Share; prefer?: Prefer }
  | { find: "controller" }
  // A friendly creep, filtered by role. Lets haulers hand energy directly to consumers (upgraders,
  // builders) when the fixed sinks are full, and lets those consumers pull from a hauler instead of
  // chasing scattered drops. `where` reads the creep's store the same way it reads a structure's:
  // "notFull" (has room to receive), "hasEnergy" (has energy to give).
  | { find: "creep"; role: RoleName | RoleName[]; where?: "notFull" | "hasEnergy"; share?: Share; prefer?: Prefer }
  | { find: "id"; id: Id<_HasId> };

// A precondition on the CREEP's own store, distinct from a target's `where`: the step only runs
// when the actor's store is in this state. "empty" gates a gather step so a still-loaded hauler
// skips picking up more and cycles back to deliver its current load first ("deliver until empty,
// only pick up when empty"). Absent = the step runs whenever the interpreter's kind-logic allows.
export type When = "empty";

export type Step = ({
  when?: When;
  // A spend step normally completes only once the actor's own store is empty (isComplete: s.used
  // === 0) — right for a bounded structure sink, which fills and goes targetGone within a couple of
  // ticks anyway. Wrong for a creep sink: an actively-working consumer (e.g. an upgrader) keeps
  // draining its own carry, so it re-validates as `notFull` every tick and the lock never breaks —
  // one consumer can then absorb an entire hauler load while closer, still-open structure sinks
  // upstream (extensions) never get re-checked. `oneShot: true` makes the step complete the instant
  // it acts, regardless of remaining `used`, so the loop wraps back to step 0 and re-scans sinks in
  // priority order on the same trip instead of pinning to one bottomless target.
  oneShot?: boolean;
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
