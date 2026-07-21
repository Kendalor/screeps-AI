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

// --- locked-target spec fit ---------------------------------------------------
// The other half of re-validating a lock: matchesWhere asks "is it still in a
// usable state?", fitsSpec asks "is it still the kind of thing the step wants?".
// Kept as a pure predicate over a kind descriptor for the same reason — the
// interesting logic is testable without the game.

export type TargetKind =
  | { kind: "structure"; structureType: StructureConstant }
  | { kind: "constructionSite" }
  | { kind: "source" }
  | { kind: "controller" }
  | { kind: "dropped" }
  | { kind: "tombstone" };

export function fitsSpec(k: TargetKind, spec: TargetSpec): boolean {
  switch (spec.find) {
    // An id-spec names one object outright, so whatever still resolves under
    // that id is by definition the thing the step asked for.
    case "id":
      return true;
    case "structure":
      return k.kind === "structure" && k.structureType === spec.type;
    case "constructionSite":
    case "source":
    case "controller":
    case "dropped":
    case "tombstone":
      return k.kind === spec.find;
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

// Classify a live object into the kind descriptor fitsSpec reads. Ordered most
// specific first: a construction site has no structureType, a structure does.
function toKind(obj: RoomObject): TargetKind | null {
  const o = obj as {
    structureType?: StructureConstant;
    progressTotal?: number;
    energyCapacity?: number;
    level?: number;
    resourceType?: ResourceConstant;
    deathTime?: number;
  };
  if (o.progressTotal !== undefined) return { kind: "constructionSite" };
  if (o.structureType !== undefined) return { kind: "structure", structureType: o.structureType };
  if (o.deathTime !== undefined) return { kind: "tombstone" };
  if (o.resourceType !== undefined) return { kind: "dropped" };
  if (o.energyCapacity !== undefined) return { kind: "source" };
  if (o.level !== undefined) return { kind: "controller" };
  return null;
}

// A lock is honoured only if the object still resolves, is still the kind the
// step asked for, and is still in a usable state. Any failure drops the lock
// and the caller searches fresh.
function validLock(locked: Id<_HasId>, spec: TargetSpec): RoomObject | null {
  const obj = Game.getObjectById(locked) as RoomObject | null;
  if (!obj) return null;
  const kind = toKind(obj);
  if (!kind || !fitsSpec(kind, spec)) return null;
  if (kind.kind === "structure" && !matchesWhere(toCandidate(obj), spec.find === "structure" ? spec.where : undefined)) {
    return null;
  }
  return obj;
}

export function resolveTarget(creep: Creep, spec: TargetSpec, locked?: Id<_HasId>): RoomObject | null {
  if (locked) {
    const held = validLock(locked, spec);
    if (held) return held;
  }
  if (spec.find === "id") {
    return Game.getObjectById(spec.id) as RoomObject | null;
  }
  if (spec.find === "controller") {
    return creep.room.controller ?? null;
  }

  const candidates = findCandidates(creep, spec).filter(
    c => spec.find !== "structure" || matchesWhere(toCandidate(c), spec.where)
  );
  // Prefer candidates still under their share cap so creeps spread out; but if
  // every valid candidate is already at capacity, fall back to the full set
  // rather than stranding the creep with no target — a shared slot frees up as
  // others cycle off, and no target means it does nothing at all.
  const uncrowded = candidates.filter(c =>
    withinShareCap(creep, (c as unknown as { id: Id<_HasId> }).id, shareCap(spec, c))
  );
  const pool = uncrowded.length > 0 ? uncrowded : candidates;

  return creep.pos.findClosestByPath(pool as RoomObject[]) ?? pool[0] ?? null;
}

// --- targeting cache ----------------------------------------------------------
// Any target a creep can pick, others may want too. Rather than every role
// re-solving "is this taken?", one claim map — derived from creeps' task.target
// locks (a lock IS a claim) — is consulted here. A spec's `share` flag says how
// many creeps may share one target: "allow"/absent = unlimited, "avoid" = 1,
// a number = that many. Sources pass their open harvest-tile count so
// harvesters spread instead of stacking on one source and blocking each other.

// Claims counted per tick and memoised so a row full of candidates doesn't
// rescan every creep. Keyed by Game.time so it self-invalidates each tick.
let claimCache: { tick: number; counts: Record<string, number> } | undefined;

function claimCounts(): Record<string, number> {
  if (claimCache?.tick === Game.time) return claimCache.counts;
  const counts: Record<string, number> = {};
  for (const name in Game.creeps) {
    const target = Game.creeps[name].memory.task?.target;
    if (target) counts[target] = (counts[target] ?? 0) + 1;
  }
  claimCache = { tick: Game.time, counts };
  return counts;
}

// The share cap for this spec against this candidate. Unlimited by default;
// sources compute their open-tile count so the cap is physical, not arbitrary.
function shareCap(spec: TargetSpec, candidate: RoomObject): number {
  if (spec.find === "source") return openHarvestTiles(candidate as Source);
  const share = (spec as { share?: "allow" | "avoid" | number }).share;
  if (share === undefined || share === "allow") return Infinity;
  if (share === "avoid") return 1;
  return share;
}

// A candidate is available if fewer than `cap` OTHER creeps have claimed it —
// the creep's own existing lock never counts against it.
function withinShareCap(creep: Creep, id: Id<_HasId>, cap: number): boolean {
  if (cap === Infinity) return true;
  const claimedByOthers = (claimCounts()[id] ?? 0) - (creep.memory.task?.target === id ? 1 : 0);
  return claimedByOthers < cap;
}

// Walkable, non-wall tiles adjacent to the source — how many creeps can harvest
// it at once, and therefore its share cap.
function openHarvestTiles(source: Source): number {
  const terrain = source.room.getTerrain();
  let open = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = source.pos.x + dx;
      const y = source.pos.y + dy;
      if (x < 0 || x > 49 || y < 0 || y > 49) continue;
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) open++;
    }
  }
  return open;
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
