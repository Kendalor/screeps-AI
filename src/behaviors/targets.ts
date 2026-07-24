// resolveTarget(spec) is the one place that searches for targets.

import type { Prefer, TargetSpec } from "./types";

export type Where = "notFull" | "hasEnergy" | "damaged";

// Live game objects satisfy this shape via their store/hits; tests pass plain objects.
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
// matchesWhere asks "is it still in a usable state?"; fitsSpec asks "is it still the kind of thing the step wants?".

export type TargetKind =
  | { kind: "structure"; structureType: StructureConstant }
  | { kind: "constructionSite" }
  | { kind: "source" }
  | { kind: "controller" }
  | { kind: "dropped" }
  | { kind: "tombstone" }
  | { kind: "creep"; role?: string };

// Role match for a creep spec: the spec names one role or a list, and the target must carry one of them.
function roleMatches(role: string | undefined, spec: Extract<TargetSpec, { find: "creep" }>): boolean {
  const wanted = Array.isArray(spec.role) ? spec.role : [spec.role];
  return role !== undefined && wanted.includes(role as never);
}

export function fitsSpec(k: TargetKind, spec: TargetSpec): boolean {
  switch (spec.find) {
    // An id-spec names one object outright — whatever resolves under that id is the thing asked for.
    case "id":
      return true;
    case "structure":
      return k.kind === "structure" && k.structureType === spec.type;
    case "creep":
      return k.kind === "creep" && roleMatches(k.role, spec);
    case "constructionSite":
    case "source":
    case "controller":
    case "dropped":
    case "tombstone":
      return k.kind === spec.find;
  }
}

// --- live-API resolution ------------------------------------------------------
// Fetches candidates for a spec, applies the where-filter, and returns the nearest by path.

// Objects without a store (source, controller, construction site) never carry a `where`.
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

// Ordered most specific first: a construction site has no structureType, a structure does.
function toKind(obj: RoomObject): TargetKind | null {
  const o = obj as {
    structureType?: StructureConstant;
    progressTotal?: number;
    energyCapacity?: number;
    level?: number;
    resourceType?: ResourceConstant;
    deathTime?: number;
    body?: unknown[];
    memory?: { role?: string };
  };
  if (o.progressTotal !== undefined) return { kind: "constructionSite" };
  if (o.structureType !== undefined) return { kind: "structure", structureType: o.structureType };
  if (o.deathTime !== undefined) return { kind: "tombstone" };
  if (o.resourceType !== undefined) return { kind: "dropped" };
  // A creep is the only positioned object with a body; read its role from memory for the spec filter.
  if (o.body !== undefined) return { kind: "creep", role: o.memory?.role };
  if (o.energyCapacity !== undefined) return { kind: "source" };
  if (o.level !== undefined) return { kind: "controller" };
  return null;
}

function validLock(locked: Id<_HasId>, spec: TargetSpec): RoomObject | null {
  const obj = Game.getObjectById(locked) as RoomObject | null;
  if (!obj) return null;
  const kind = toKind(obj);
  if (!kind || !fitsSpec(kind, spec)) return null;
  // Structures and creeps both carry a store-based `where`; re-check the lock still satisfies it
  // (an extension that filled, a hauler that emptied) so the creep drops a stale target.
  const where = spec.find === "structure" || spec.find === "creep" ? spec.where : undefined;
  if ((kind.kind === "structure" || kind.kind === "creep") && !matchesWhere(toCandidate(obj), where)) {
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

  // Both structure and creep specs carry a `where` read off the target's store; apply it to either.
  const candidates = findCandidates(creep, spec).filter(
    c => (spec.find !== "structure" && spec.find !== "creep") || matchesWhere(toCandidate(c), spec.where)
  );
  // A pile below the worthwhile floor is deprioritized, not excluded — falls back to the full
  // set below if nothing clears the bar, same as the share-cap fallback.
  const worthwhile = spec.find !== "dropped" ? candidates : candidates.filter(c => isWorthwhile(creep, c));
  const consider = worthwhile.length > 0 ? worthwhile : candidates;
  // Fall back to the full set if every candidate is at its share cap — no target means the creep does nothing at all.
  const uncrowded = consider.filter(c =>
    withinShareCap(creep, (c as unknown as { id: Id<_HasId> }).id, shareCap(spec, c))
  );
  const pool = applyPrefer(spec, uncrowded.length > 0 ? uncrowded : consider);

  return creep.pos.findClosestByPath(pool as RoomObject[]) ?? pool[0] ?? null;
}

// Orders the pool so the pool[0] fallback (and ties in findClosestByPath) resolve the same way
// every time, instead of following room.find()'s unspecified order. Opt-in via spec.prefer — no
// prefer means the step's existing (undetermined-order) behavior is unchanged.
function applyPrefer(spec: TargetSpec, pool: RoomObject[]): RoomObject[] {
  const prefer = (spec as { prefer?: Prefer }).prefer;
  if (prefer === "largest") {
    return [...pool].sort((a, b) => (b as unknown as { amount: number }).amount - (a as unknown as { amount: number }).amount);
  }
  if (prefer === "mostProgress") {
    return [...pool].sort((a, b) => (b as unknown as { progress: number }).progress - (a as unknown as { progress: number }).progress);
  }
  return pool;
}

// The minimum a drop pile must hold before a creep will walk to it: a fraction of the
// collector's own free capacity, plus a small absolute floor so a big creep doesn't ignore
// every pile in an empty room. Scales from RCL1 to RCL8 with no retuning.
const WORTHWHILE_FRACTION = 0.25;
const WORTHWHILE_FLOOR = 50;

function isWorthwhile(creep: Creep, candidate: RoomObject): boolean {
  const amount = (candidate as unknown as { amount: number }).amount;
  const free = creep.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0;
  return amount >= Math.max(WORTHWHILE_FRACTION * free, WORTHWHILE_FLOOR);
}

// --- targeting cache ----------------------------------------------------------
// A claim map derived from creeps' task.target locks (a lock IS a claim), consulted so roles don't stack on one target.

// Memoised per tick (keyed by Game.time) so a row full of candidates doesn't rescan every creep.
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

// A reference collector's worth of capacity (a cheap 2-CARRY hauler set) — the unit a pile's
// claim limit is measured against, so a large pile absorbs several collectors and a small one
// locks to one.
const REFERENCE_CLAIM_CAPACITY = 100;

// Unlimited by default; sources use their open-tile count and drop piles their size so the cap is physical, not arbitrary.
function shareCap(spec: TargetSpec, candidate: RoomObject): number {
  if (spec.find === "source") return openHarvestTiles(candidate as Source);
  if (spec.find === "dropped") {
    const amount = (candidate as unknown as { amount: number }).amount;
    return Math.max(1, Math.ceil(amount / REFERENCE_CLAIM_CAPACITY));
  }
  const share = (spec as { share?: "allow" | "avoid" | number }).share;
  if (share === undefined || share === "allow") return Infinity;
  if (share === "avoid") return 1;
  return share;
}

// The creep's own existing lock never counts against its own cap check.
function withinShareCap(creep: Creep, id: Id<_HasId>, cap: number): boolean {
  if (cap === Infinity) return true;
  const claimedByOthers = (claimCounts()[id] ?? 0) - (creep.memory.task?.target === id ? 1 : 0);
  return claimedByOthers < cap;
}

// Walkable tiles adjacent to a position, i.e. its share cap. Takes any positioned
// object (not just Source) so the snapshot builder can reuse it for the same count.
export function openHarvestTiles(at: { pos: { x: number; y: number }; room: { getTerrain(): { get(x: number, y: number): number } } }): number {
  const terrain = at.room.getTerrain();
  let open = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const x = at.pos.x + dx;
      const y = at.pos.y + dy;
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
    case "creep": {
      // Own creeps of the named role(s), never the actor itself — a creep transferring to itself is a no-op.
      const wanted = Array.isArray(spec.role) ? spec.role : [spec.role];
      return room
        .find(FIND_MY_CREEPS)
        .filter(c => c.id !== creep.id && c.memory.role !== undefined && wanted.includes(c.memory.role as never));
    }
  }
}
