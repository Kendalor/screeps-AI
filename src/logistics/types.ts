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
  | { kind: "ruin"; id: Id<Ruin> }
  | { kind: "creep"; id: Id<Creep> };

export interface LogisticsTask {
  kind: "pickup" | "deliver" | "travelHome";
  from?: NodeRef; // pickup: where to withdraw/pickup from
  to?: NodeRef; // deliver: where to transfer to
  resource: ResourceConstant;
  amount: number; // capped to creep capacity when assigned; informational for matching
  // The follow-up leg, assigned together with this one so a creep flows straight through with no idle
  // re-plan tick between them. A trip is a chain of pickups terminating in one deliver — e.g.
  // pickup(A) -> pickup(B) -> deliver(consumer) when no single provider fills the creep for that
  // consumer (see allocate.ts). runTransport promotes `next` to `current` the instant the current leg
  // completes (see behaviors/logisticsRunner.ts). The terminal deliver has no `next` of its own; the creep
  // goes idle after it and gets re-planned fresh.
  //
  // "travelHome" is deliberately NOT chained onto a pickup: it is assigned on its own, once a loaded
  // creep is found sitting outside its home room (see allocate.ts's byLoadedFirst pass). It reserves
  // nothing — no `from`/`to` — so foldReserved skips it entirely; a deliver only gets picked (and its
  // consumer reserved) once the creep is re-planned from inside the home room. This is what keeps a
  // 60-tick remote-return trip from parking a spawn/extension reservation for the whole trip: the
  // reservation window is only the short walk from the room edge to the sink, not the cross-room haul.
  next?: LogisticsTask;
}
