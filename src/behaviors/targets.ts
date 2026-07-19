// resolveTarget(spec) — the ONE place that searches for targets
// (docs/rewrite-skeleton.md §5), replacing ~60 copies of getTargetId.
//
// The `where` filter is a pure predicate over the facts a candidate exposes, so
// it is unit-tested without the game. resolveTarget (live-API candidate fetch)
// is added next and reuses this predicate.

import type { TargetSpec } from "./types";

export type Where = "notFull" | "hasEnergy" | "damaged";

// The candidate facts the where-predicates read. Live game objects satisfy this
// shape via their store / hits; tests pass plain objects.
export interface TargetCandidate {
  freeCapacity: number;
  usedCapacity: number;
  hits: number;
  hitsMax: number;
}

export function matchesWhere(c: TargetCandidate, where: Where | undefined): boolean {
  switch (where) {
    case "notFull":
      return c.freeCapacity > 0;
    case "hasEnergy":
      return c.usedCapacity > 0;
    case "damaged":
      return c.hits < c.hitsMax;
    case undefined:
      return true;
  }
}

// --- live-API resolution ------------------------------------------------------
// Fetches candidates for a spec, applies the where-filter (via the tested
// predicate), and returns the nearest by path. This is the single searcher the
// interpreter calls; not unit-tested (touches Game) — covered by the
// integration harness.

// Adapt a live game object to the candidate facts the predicate reads. Objects
// without a store (source, controller, construction site) never carry a `where`.
function toCandidate(obj: RoomObject): TargetCandidate {
  const store = (obj as { store?: StoreDefinition }).store;
  const withHits = obj as { hits?: number; hitsMax?: number };
  return {
    freeCapacity: store ? store.getFreeCapacity(RESOURCE_ENERGY) ?? 0 : 0,
    usedCapacity: store ? store.getUsedCapacity(RESOURCE_ENERGY) ?? 0 : 0,
    hits: withHits.hits ?? 0,
    hitsMax: withHits.hitsMax ?? 0
  };
}

export function resolveTarget(creep: Creep, spec: TargetSpec): RoomObject | null {
  if (spec.find === "id") {
    return Game.getObjectById(spec.id) as RoomObject | null;
  }
  if (spec.find === "controller") {
    return creep.room.controller ?? null;
  }

  const candidates = findCandidates(creep, spec);
  const filtered =
    spec.find === "structure"
      ? candidates.filter(c => matchesWhere(toCandidate(c), spec.where))
      : candidates;

  return creep.pos.findClosestByPath(filtered as RoomObject[]) ?? filtered[0] ?? null;
}

function findCandidates(creep: Creep, spec: Exclude<TargetSpec, { find: "id" } | { find: "controller" }>): RoomObject[] {
  const room = creep.room;
  switch (spec.find) {
    case "source":
      return room.find(FIND_SOURCES).filter(s => s.energy > 0);
    case "dropped":
      return room.find(FIND_DROPPED_RESOURCES);
    case "tombstone":
      return room.find(FIND_TOMBSTONES).filter(t => t.store.getUsedCapacity() > 0);
    case "constructionSite":
      return room.find(FIND_MY_CONSTRUCTION_SITES);
    case "structure":
      return room.find(FIND_STRUCTURES).filter(s => s.structureType === spec.type);
  }
}
