// resolveTarget(spec) is the one place that searches for targets.

import { wrapFn } from "../lib/profiler";
import type { Prefer, TargetSpec } from "./types";

export type Where = "notFull" | "hasEnergy" | "damaged";

// Range 2 of the controller is where the controller container sits — an upgrader standing on it is still
// in upgrade range (3). `near: "controller"`/"notController" partition containers by this radius.
const CONTROLLER_CONTAINER_RANGE = 2;

type Near = "assignedSource" | "controller" | "notController";

// Positional filter shared by the live search and the locked-target re-check, so a lock survives exactly
// the same near-test a fresh search would apply. A structure with no `near` always matches.
function nearMatches(creep: Creep, s: { pos: RoomPosition }, near: Near | undefined): boolean {
  switch (near) {
    case undefined:
      return true;
    case "assignedSource": {
      const source = creep.memory.sourceId && (Game.getObjectById(creep.memory.sourceId) as Source | null);
      return !!source && s.pos.inRangeTo(source.pos, 1);
    }
    case "controller": {
      const controller = creep.room.controller;
      return !!controller && s.pos.inRangeTo(controller.pos, CONTROLLER_CONTAINER_RANGE);
    }
    case "notController": {
      const controller = creep.room.controller;
      // No controller (never happens in an owned room) means nothing to exclude — every container qualifies.
      return !controller || !s.pos.inRangeTo(controller.pos, CONTROLLER_CONTAINER_RANGE);
    }
  }
}

// Ready-made "any" groups for the two directions energy moves: gathering it up (storage/containers
// with energy, dropped piles, tombstones) and spending it down (extensions/spawn/storage/containers
// with room to take more). Pooling these into one "any" spec — rather than a priority-ordered chain of
// single-kind steps — means a nearer candidate of the *second* kind in the chain is never passed over
// just because the first kind's search happened to find something.
// energySourceGroup mixes a pickup-shaped kind (dropped) with withdraw-shaped kinds (structure,
// tombstone) — pair it with a "gather" step, not "withdraw"/"pickup", which each call one fixed API
// regardless of what the spec resolves to.
export function energySourceGroup(prefer?: Prefer): TargetSpec {
  return {
    find: "any",
    prefer,
    of: [
      { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy" },
      { find: "dropped" },
      { find: "tombstone" }
    ]
  };
}

export function energySinkGroup(prefer?: Prefer): TargetSpec {
  return {
    find: "any",
    prefer,
    of: [{ find: "structure", type: [STRUCTURE_EXTENSION, STRUCTURE_SPAWN, STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "notFull" }]
  };
}

// Live game objects satisfy this shape via their store/hits; tests pass plain objects.
export interface TargetCandidate {
  freeCapacity: number;
  usedCapacity: number;
  hits: number;
  hitsMax: number;
}

// True when the candidate's energy fraction is below `fillTo` (0..1), i.e. it still wants topping up. No
// `fillTo` set means no cap — always true. A zero-capacity candidate can't be filled, so it never wants more.
export function belowFillTo(c: TargetCandidate, fillTo: number | undefined): boolean {
  if (fillTo === undefined) return true;
  const capacity = c.usedCapacity + c.freeCapacity;
  if (capacity <= 0) return false;
  return c.usedCapacity / capacity < fillTo;
}

// True when the candidate's hits fraction is below `repairBelow` (0..1), i.e. it has decayed far enough
// to want repairing. No `repairBelow` set means no gate — always true. A candidate with no hitsMax (a
// site, a source) can't be repaired, so it never qualifies. The repair counterpart of belowFillTo.
export function belowRepair(c: TargetCandidate, repairBelow: number | undefined): boolean {
  if (repairBelow === undefined) return true;
  if (c.hitsMax <= 0) return false;
  return c.hits / c.hitsMax < repairBelow;
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
  | { kind: "constructionSite"; structureType?: StructureConstant }
  | { kind: "source" }
  | { kind: "controller" }
  | { kind: "dropped" }
  | { kind: "tombstone" }
  | { kind: "creep"; role?: string }
  | { kind: "hostile" };

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
      return (
        k.kind === "structure" &&
        (Array.isArray(spec.type) ? spec.type.includes(k.structureType) : k.structureType === spec.type)
      );
    case "creep":
      return k.kind === "creep" && roleMatches(k.role, spec);
    case "constructionSite":
      // A site with no scoped structureType matches any spec; a scoped spec matches only its type.
      return k.kind === "constructionSite" && (spec.structureType === undefined || k.structureType === spec.structureType);
    case "source":
    case "controller":
    case "dropped":
    case "tombstone":
    case "hostile":
      return k.kind === spec.find;
    case "any":
      return spec.of.some(member => fitsSpec(k, member));
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
    my?: boolean;
  };
  // A construction site carries progressTotal AND a structureType (what it will become); capture the
  // latter so a scoped constructionSite spec can filter on it.
  if (o.progressTotal !== undefined) return { kind: "constructionSite", structureType: o.structureType };
  if (o.structureType !== undefined) return { kind: "structure", structureType: o.structureType };
  if (o.deathTime !== undefined) return { kind: "tombstone" };
  if (o.resourceType !== undefined) return { kind: "dropped" };
  // A creep is the only positioned object with a body; `.my` splits it into a friendly (role read off
  // memory, which only exists on owned creeps) or a hostile (no memory, never role-filtered).
  if (o.body !== undefined) return o.my ? { kind: "creep", role: o.memory?.role } : { kind: "hostile" };
  if (o.energyCapacity !== undefined) return { kind: "source" };
  if (o.level !== undefined) return { kind: "controller" };
  return null;
}

function validLock(creep: Creep, locked: Id<_HasId>, spec: TargetSpec): RoomObject | null {
  const obj = Game.getObjectById(locked) as RoomObject | null;
  if (!obj) return null;
  const kind = toKind(obj);
  if (!kind || !fitsSpec(kind, spec)) return null;
  // An "any" lock re-validates against whichever member spec the object actually fits, so its own
  // where/near rules (not some other member's) govern whether the lock survives.
  const memberSpec = spec.find === "any" ? spec.of.find(m => fitsSpec(kind, m)) : spec;
  if (!memberSpec) return null;
  // Re-check the store-based `where` so a lock on a now-filled extension or emptied hauler is dropped.
  const where = memberSpec.find === "structure" || memberSpec.find === "creep" ? memberSpec.where : undefined;
  if ((kind.kind === "structure" || kind.kind === "creep") && !matchesWhere(toCandidate(obj), where)) {
    return null;
  }
  // A locked container/link must still pass the same positional and fill/repair-fraction tests a fresh
  // search applies — otherwise a lock taken on a sibling source's container (before sourceId was set), a
  // controller container that has since crossed its fill floor, or a container repaired back above its
  // repair floor, would survive stale.
  if (memberSpec.find === "structure") {
    const s = obj as unknown as { pos: RoomPosition };
    if (!nearMatches(creep, s, memberSpec.near)) return null;
    if (!belowFillTo(toCandidate(obj), memberSpec.fillTo)) return null;
    if (!belowRepair(toCandidate(obj), memberSpec.repairBelow)) return null;
  }
  // A locked construction site scoped by position must still sit where the spec wants it.
  if (memberSpec.find === "constructionSite") {
    const s = obj as unknown as { pos: RoomPosition };
    if (!nearMatches(creep, s, memberSpec.near)) return null;
  }
  // A locked drop pile must release the instant the spawn system starts needing energy, same as a
  // fresh search would never offer it — otherwise a builder/upgrader already travelling to one keeps
  // going even after another creep's delivery (or the miner's own overflow) reopens spawn demand.
  if (memberSpec.find === "dropped" && memberSpec.unlessSpawnNeedsEnergy && spawnNeedsEnergy(creep.room)) {
    return null;
  }
  return obj;
}

export const resolveTarget = wrapFn(function resolveTarget(creep: Creep, spec: TargetSpec, locked?: Id<_HasId>): RoomObject | null {
  if (locked) {
    const held = validLock(creep, locked, spec);
    if (held) return held;
  }
  if (spec.find === "id") {
    return Game.getObjectById(spec.id) as RoomObject | null;
  }
  if (spec.find === "controller") {
    return creep.room.controller ?? null;
  }
  if (spec.find === "any") {
    // Each member resolves its own pool under its own where/worthwhile/share rules; only the final
    // nearest-vs-largest-vs-mostProgress ranking is shared across the merged set.
    const pool = spec.of.flatMap(member => poolFor(creep, member));
    return pickByPrefer(creep, spec, pool);
  }

  return pickByPrefer(creep, spec, poolFor(creep, spec));
}, "targets:resolveTarget");

// Candidate pool for one non-"any", non-"id", non-"controller" spec: found, where-filtered,
// worthwhile-filtered (drops only), then share-capped with fallback to the full set at each stage.
function poolFor(creep: Creep, spec: Exclude<TargetSpec, { find: "id" } | { find: "controller" } | { find: "any" }>): RoomObject[] {
  // Both structure and creep specs carry a `where` read off the target's store; apply it to either.
  // A structure spec may also carry `fillTo`, a hard cap on fill fraction (not a fallback like the
  // worthwhile floor): a controller container already at its floor must genuinely drop out so the step
  // falls through to storage.
  // A gate on the ROOM, not the candidate — checked once and applied to the whole pool rather than
  // per-candidate. Unlike fillTo/worthwhile there is no fallback to the full set: while the spawn system
  // needs energy the pool is genuinely empty, so the step falls through to whatever comes next (self-harvest).
  if (spec.find === "dropped" && spec.unlessSpawnNeedsEnergy && spawnNeedsEnergy(creep.room)) return [];
  const candidates = findCandidates(creep, spec).filter(c => {
    if (spec.find !== "structure" && spec.find !== "creep") return true;
    if (!matchesWhere(toCandidate(c), spec.where)) return false;
    if (spec.find === "structure" && !belowFillTo(toCandidate(c), spec.fillTo)) return false;
    if (spec.find === "structure" && !belowRepair(toCandidate(c), spec.repairBelow)) return false;
    return true;
  });
  // Below-floor piles are deprioritized, not excluded — falls back to the full set if nothing clears the bar.
  const worthwhile = spec.find !== "dropped" ? candidates : candidates.filter(c => isWorthwhile(creep, c));
  const consider = worthwhile.length > 0 ? worthwhile : candidates;
  // Fall back to the full set if every candidate is at its share cap — no target means the creep does nothing at all.
  const uncrowded = consider.filter(c =>
    withinShareCap(creep, (c as unknown as { id: Id<_HasId> }).id, shareCap(spec, c))
  );
  return uncrowded.length > 0 ? uncrowded : consider;
}

// The step decides how a target is picked; there is no implicit fallback search. "nearest" (the
// default when a spec omits `prefer`) is the only strategy that asks the path engine — "largest" and
// "mostProgress" sort the pool themselves and take the winner outright, so they no longer get
// silently overridden by proximity.
function pickByPrefer(creep: Creep, spec: TargetSpec, pool: RoomObject[]): RoomObject | null {
  const prefer = (spec as { prefer?: Prefer }).prefer ?? "nearest";
  if (prefer === "largest") {
    const sorted = [...pool].sort((a, b) => energyAmount(b) - energyAmount(a));
    return sorted[0] ?? null;
  }
  if (prefer === "mostProgress") {
    const sorted = [...pool].sort(
      (a, b) => (b as unknown as { progress: number }).progress - (a as unknown as { progress: number }).progress
    );
    return sorted[0] ?? null;
  }
  if (prefer === "mostDamaged") {
    // Lowest hits fraction first — the structure closest to being lost. A candidate with no hitsMax
    // (never happens on a "damaged" pool, but guard anyway) sorts to the back.
    const sorted = [...pool].sort((a, b) => damageFraction(a) - damageFraction(b));
    return sorted[0] ?? null;
  }
  return creep.pos.findClosestByPath(pool) ?? pool[0] ?? null;
}

// Energy a candidate holds, across the two shapes a gather pool mixes: dropped Resources expose
// `.amount`, store-holders (containers, tombstones) expose `.store`. Used to rank a "largest" pool
// uniformly — reading `.amount` off a store-holder would yield undefined and poison the sort.
function energyAmount(o: RoomObject): number {
  const amount = (o as unknown as { amount?: number }).amount;
  if (amount !== undefined) return amount;
  const store = (o as unknown as { store?: Store<ResourceConstant, false> }).store;
  return store?.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
}

// Fraction of max hits a structure still has; ranks a "mostDamaged" pool ascending (lowest = most
// damaged, picked first). A candidate with no hitsMax sorts to 1 (undamaged), never chosen over a real one.
function damageFraction(o: RoomObject): number {
  const h = o as unknown as { hits?: number; hitsMax?: number };
  if (!h.hitsMax || h.hitsMax <= 0) return 1;
  return (h.hits ?? 0) / h.hitsMax;
}

// True while the room's spawn system (spawn + extensions) has spare capacity — the hauler's own top
// priority. Gates builder/upgrader dropped-energy pickup so they leave ground piles for the hauler
// instead of racing it for the energy the spawn needs to produce replacements.
function spawnNeedsEnergy(room: Room): boolean {
  return room.energyAvailable < room.energyCapacityAvailable;
}

const WORTHWHILE_FRACTION = 0.25; // fraction of the collector's free capacity a drop pile must hold
const WORTHWHILE_FLOOR = 50; // absolute floor so a big creep doesn't ignore every pile in an empty room

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

const REFERENCE_CLAIM_CAPACITY = 100; // a cheap 2-CARRY hauler's worth; unit a pile's claim limit is measured against

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

// Walkable tiles adjacent to a position, i.e. its share cap.
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

function findCandidates(
  creep: Creep,
  spec: Exclude<TargetSpec, { find: "id" } | { find: "controller" } | { find: "any" }>
): RoomObject[] {
  const room = creep.room;
  switch (spec.find) {
    case "source": {
      const sources = room.find(FIND_SOURCES).filter(s => s.energy > 0);
      // An assigned miner harvests only its source — mining.ts's per-source WORK accounting depends on it.
      const assigned = creep.memory.sourceId;
      if (assigned === undefined) return sources;
      return sources.filter(s => s.id === assigned);
    }
    case "dropped":
      return room.find(FIND_DROPPED_RESOURCES);
    case "tombstone":
      return room.find(FIND_TOMBSTONES).filter(t => t.store.getUsedCapacity() > 0);
    case "hostile":
      return room.find(FIND_HOSTILE_CREEPS);
    case "constructionSite": {
      const sites = room.find(FIND_MY_CONSTRUCTION_SITES).filter(s => spec.structureType === undefined || s.structureType === spec.structureType);
      return sites.filter(s => nearMatches(creep, s, spec.near));
    }
    case "structure": {
      const wantedTypes = Array.isArray(spec.type) ? spec.type : [spec.type];
      const structures = room.find(FIND_STRUCTURES).filter(s => wantedTypes.includes(s.structureType));
      return structures.filter(s => nearMatches(creep, s, spec.near));
    }
    case "creep": {
      // Never the actor itself — a creep transferring to itself is a no-op.
      const wanted = Array.isArray(spec.role) ? spec.role : [spec.role];
      return room
        .find(FIND_MY_CREEPS)
        .filter(c => c.id !== creep.id && c.memory.role !== undefined && wanted.includes(c.memory.role as never));
    }
  }
}
