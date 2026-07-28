// Data model for the colony-level transport system. Pure types only — no Game.* here, matching every
// other planner boundary (ColonySnapshot in, plain data out).

// "spawnSystem" is the one aggregate node: the snapshot carries colony-wide energyAvailable/
// energyCapacity for spawn+extensions together, not a per-structure store, so the graph can size the
// pool's demand but can't name which extension. The transport executor resolves an actual structure
// live (mirrors hauler.ts's own STRUCTURE_SPAWN/STRUCTURE_EXTENSION "any" pool) when a task lands.
export type NodeRef =
  | { kind: "structure"; id: Id<AnyStoreStructure> }
  | { kind: "spawnSystem" }
  | { kind: "dropped"; id: Id<Resource> }
  | { kind: "tombstone"; id: Id<Tombstone> }
  | { kind: "creep"; id: Id<Creep> };

export interface LogisticsTask {
  kind: "pickup" | "deliver";
  from?: NodeRef; // pickup: where to withdraw/pickup from
  to?: NodeRef; // deliver: where to transfer to
  resource: ResourceConstant;
  amount: number; // capped to creep capacity when assigned; informational for matching
  // The follow-up leg, assigned together with this one so a creep flows straight through with no idle
  // re-plan tick between them. A trip is a chain of pickups terminating in one deliver — e.g.
  // pickup(A) -> pickup(B) -> deliver(consumer) when no single provider fills the creep for that
  // consumer (see allocate.ts). runTransport promotes `next` to `current` the instant the current leg
  // completes (see behaviors/transport.ts). The terminal deliver has no `next` of its own; the creep
  // goes idle after it and gets re-planned fresh. Every pickup in the chain also carries the consumer
  // in its own `to` so foldReserved can read the destination off `current` without walking the chain.
  next?: LogisticsTask;
}
