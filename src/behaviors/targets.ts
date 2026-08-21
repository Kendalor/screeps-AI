// resolveTarget(spec) is the one place that searches for targets.

import { ATTACK_POWER, HEAL_ASSIST_RANGE, RANGED_ATTACK_POWER, effectiveHp } from "../lib/combat";
import { wrapFn } from "../lib/profiler";
import type { Prefer, TargetSpec } from "./types";

export type Where = "notFull" | "hasEnergy" | "damaged";

// Range 1 of the controller is where the controller container sits — an upgrader standing on it is still
// in upgrade range (3). `near: "controller"`/"notController" partition containers by this radius.
const CONTROLLER_CONTAINER_RANGE = 1;

type Near = "assignedSource" | "assignedMineral" | "controller" | "notController";

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
    case "assignedMineral": {
      const mineral = creep.memory.mineralId && (Game.getObjectById(creep.memory.mineralId) as Mineral | null);
      return !!mineral && s.pos.inRangeTo(mineral.pos, 1);
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

// True unless the spec asks for the reachability gate AND the creep can't survive the trip: ticksToLive
// undefined (a fresh test double, or a creep type that never dies of age within a run) always passes: the
// gate only fires when we can actually name a deadline. Range is a straight-line lower bound on travel
// time — cheap enough to check per-candidate, and safe for a hauler (built 1 MOVE per CARRY, never
// fatigues) since its real travel time is never less than range.
function reachableAlive(creep: Creep, s: { pos: RoomPosition }, required: boolean | undefined): boolean {
  if (!required) return true;
  if (creep.ticksToLive === undefined) return true;
  return creep.pos.getRangeTo(s.pos) < creep.ticksToLive;
}

// True unless the creep's own CARRY count is at/below the given floor AND the site sits farther than
// `range` from the room's controller — a low-CARRY creep (e.g. the base upgrader body's single CARRY)
// can't afford the round trip to refill after a long walk to a distant site, so it leaves those to a
// creep built for it. No `onlyIfCarryOver` set means unconditional (every existing caller's behavior).
function withinCarryRange(creep: Creep, s: { pos: RoomPosition }, gate: { carry: number; range: number } | undefined): boolean {
  if (!gate) return true;
  if (creep.getActiveBodyparts(CARRY) > gate.carry) return true;
  const controller = creep.room.controller;
  return !!controller && s.pos.inRangeTo(controller.pos, gate.range);
}

// Ready-made "any" groups for the two directions energy moves: gathering it up (storage/containers
// with energy, dropped piles, tombstones, ruins) and spending it down (extensions/spawn/storage/containers
// with room to take more). Pooling these into one "any" spec — rather than a priority-ordered chain of
// single-kind steps — means a nearer candidate of the *second* kind in the chain is never passed over
// just because the first kind's search happened to find something.
// energySourceGroup mixes a pickup-shaped kind (dropped) with withdraw-shaped kinds (structure,
// tombstone, ruin) — pair it with a "gather" step, not "withdraw"/"pickup", which each call one fixed
// API regardless of what the spec resolves to.
export function energySourceGroup(prefer?: Prefer): TargetSpec {
  return {
    find: "any",
    prefer,
    of: [
      { find: "structure", type: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER], where: "hasEnergy" },
      { find: "dropped" },
      { find: "tombstone" },
      { find: "ruin" }
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
  | { kind: "mineral" }
  | { kind: "controller" }
  | { kind: "dropped" }
  | { kind: "tombstone" }
  | { kind: "ruin" }
  | { kind: "creep"; role?: string; op?: string }
  | { kind: "hostile" }
  | { kind: "hostileStructure"; structureType: StructureConstant }
  | { kind: "hostileConstructionSite" };

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
    case "mineral":
    case "controller":
    case "dropped":
    case "tombstone":
    case "ruin":
    case "hostile":
    case "hostileStructure":
    case "hostileConstructionSite":
      return k.kind === spec.find;
    // op equality can't be expressed here — fitsSpec only sees the target's own kind, not the acting
    // creep's memory.op to compare against. Enforced instead where the acting creep is available:
    // findCandidates (fresh search) and validLock (re-check) below.
    case "squadMate":
    case "friendly":
      return k.kind === "creep";
    case "any":
      return spec.of.some(member => fitsSpec(k, member));
  }
}

// --- live-API resolution ------------------------------------------------------
// Fetches candidates for a spec, applies the where-filter, and returns the nearest by path.

// Objects without a store (source, controller, construction site) never carry a `where`. `resource`
// defaults to energy — the overwhelming common case — but a structure spec may override it (see
// TargetSpec's own doc) for a store that never holds energy at all, e.g. a mineral container; "any"
// reads the store's general (all-resources) capacity instead of one resource's.
function toCandidate(obj: RoomObject, resource: ResourceConstant | "any" = RESOURCE_ENERGY): TargetCandidate {
  const store = (obj as { store?: StoreDefinition }).store;
  const withHits = obj as { hits?: number; hitsMax?: number };
  return {
    freeCapacity: store ? (resource === "any" ? store.getFreeCapacity() : store.getFreeCapacity(resource)) ?? 0 : 0,
    usedCapacity: store ? (resource === "any" ? store.getUsedCapacity() : store.getUsedCapacity(resource)) ?? 0 : 0,
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
    mineralType?: MineralConstant;
    deathTime?: number;
    destroyTime?: number;
    body?: unknown[];
    memory?: { role?: string; op?: string };
    my?: boolean;
  };
  // A construction site carries progressTotal AND a structureType (what it will become); capture the
  // latter so a scoped constructionSite spec can filter on it. `.my` is false only for a site owned by
  // another player — our own sites (the overwhelming common case) and neutral ones (there is no neutral
  // site; every site has an owner) both read true, so hostileConstructionSite spec never matches our own.
  if (o.progressTotal !== undefined) {
    return o.my === false ? { kind: "hostileConstructionSite" } : { kind: "constructionSite", structureType: o.structureType };
  }
  // `.my` is false for a structure owned by another player, true for ours, undefined for one with no
  // owner concept (roads, walls, containers, ruins-adjacent neutral structures) — only the explicit
  // false case is a hostile structure; undefined must fall through to the ordinary "structure" kind so
  // e.g. a neutral container is still findable by every existing find:"structure" spec. A hostile-owned
  // controller is excluded the same way findCandidates' "hostileStructure" case excludes it (see that
  // doc) — classified as an ordinary "structure" instead so it never re-validates a stale hostileStructure
  // lock either.
  if (o.structureType !== undefined) {
    // STRUCTURE_KEEPER_LAIR excluded alongside the controller: both resolve under Structure.my === false
    // but neither is a fightable hostileStructure target — see hostileStructure's own doc in
    // findCandidates below for why.
    return o.my === false && o.structureType !== STRUCTURE_CONTROLLER && o.structureType !== STRUCTURE_KEEPER_LAIR
      ? { kind: "hostileStructure", structureType: o.structureType }
      : { kind: "structure", structureType: o.structureType };
  }
  if (o.deathTime !== undefined) return { kind: "tombstone" };
  if (o.destroyTime !== undefined) return { kind: "ruin" };
  if (o.resourceType !== undefined) return { kind: "dropped" };
  // A creep is the only positioned object with a body; `.my` splits it into a friendly (role AND op read
  // off memory, which only exists on owned creeps — a hostile creep has no .memory at all) or a hostile
  // (never role/op-filtered).
  if (o.body !== undefined) return o.my ? { kind: "creep", role: o.memory?.role, op: o.memory?.op } : { kind: "hostile" };
  if (o.energyCapacity !== undefined) return { kind: "source" };
  if (o.mineralType !== undefined) return { kind: "mineral" };
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
  // A defender's "hostile" lock must not survive the target fleeing out of defendTargetRoom — Defender
  // exists to hold its assigned room, not roam after a chased target (Attacker has no such constraint:
  // attackTargetRoom IS the room it's meant to clear, so chasing a fleeing hostile there is the point).
  // Confirmed live: a defender's lock on a fled enemy hauler survived cross-room (validLock has no
  // same-room check for "hostile") and interpreter.ts's cross-room attackStep branch then walked it
  // straight into a neighboring hostile-owned room chasing an unarmed, unkillable-in-time target.
  if (memberSpec.find === "hostile" && creep.memory.defendTargetRoom !== undefined) {
    const pos = (obj as unknown as { pos: RoomPosition }).pos;
    if (pos.roomName !== creep.memory.defendTargetRoom) return null;
  }
  // Same rule as the defender's "hostile" lock above, for SimpleHealer's "friendly" lock: a patient that
  // wanders out of targetRoom must not drag the healer along behind it (SimpleHealer holds its assigned
  // room, same as Defender — see simpleHealer.ts's doc).
  if (memberSpec.find === "friendly" && creep.memory.targetRoom !== undefined) {
    const pos = (obj as unknown as { pos: RoomPosition }).pos;
    if (pos.roomName !== creep.memory.targetRoom) return null;
  }
  // Re-check the store/hits-based `where` so a lock on a now-filled extension, emptied hauler, or
  // healed-back-to-full friendly creep is dropped.
  const where =
    memberSpec.find === "structure" || memberSpec.find === "creep" || memberSpec.find === "friendly"
      ? memberSpec.where
      : undefined;
  if (
    (kind.kind === "structure" || kind.kind === "creep") &&
    !matchesWhere(toCandidate(obj, memberSpec.find === "structure" ? memberSpec.resource : undefined), where)
  ) {
    return null;
  }
  // A locked squad-mate must still share the acting creep's own op — a stale lock taken before a
  // reassignment (or on a creep whose op changed) must not survive, same as any other locked-target re-check.
  if (memberSpec.find === "squadMate" && kind.kind === "creep" && kind.op !== creep.memory.op) {
    return null;
  }
  // A locked container/link must still pass the same positional and fill/repair-fraction tests a fresh
  // search applies — otherwise a lock taken on a sibling source's container (before sourceId was set), a
  // controller container that has since crossed its fill floor, or a container repaired back above its
  // repair floor, would survive stale.
  if (memberSpec.find === "structure") {
    const s = obj as unknown as { pos: RoomPosition };
    if (!nearMatches(creep, s, memberSpec.near)) return null;
    if (!belowFillTo(toCandidate(obj, memberSpec.resource), memberSpec.fillTo)) return null;
    if (!belowRepair(toCandidate(obj, memberSpec.resource), memberSpec.repairBelow)) return null;
    if (!reachableAlive(creep, s, memberSpec.requireReachableAlive)) return null;
  }
  // A locked source must release the instant its room's controller becomes hostile-reserved — same
  // rule a fresh search applies (see findCandidates' "source" case) — otherwise a creep that locked on
  // before the reservation appeared (or before this gate existed) keeps retrying a harvest() that can
  // never succeed, forever.
  if (memberSpec.find === "source" && hostileReserved(creep, creep.room)) {
    return null;
  }
  // A locked construction site scoped by position must still sit where the spec wants it.
  if (memberSpec.find === "constructionSite") {
    const s = obj as unknown as { pos: RoomPosition };
    if (!nearMatches(creep, s, memberSpec.near)) return null;
    if (!withinCarryRange(creep, s, memberSpec.onlyIfCarryOver)) return null;
  }
  // A locked drop pile must release the instant the spawn system starts needing energy, same as a
  // fresh search would never offer it — otherwise a builder/upgrader already travelling to one keeps
  // going even after another creep's delivery (or the miner's own overflow) reopens spawn demand.
  if (memberSpec.find === "dropped" && memberSpec.unlessSpawnNeedsEnergy && spawnNeedsEnergy(creep.room)) {
    return null;
  }
  // A locked dropped/tombstone/ruin pile must release once the creep's own remaining lifespan can no
  // longer cover the trip — same rule a fresh search applies below, so a lock taken while ticksToLive was
  // still comfortable doesn't survive stale as it ticks down mid-approach.
  if (memberSpec.find === "dropped" || memberSpec.find === "tombstone" || memberSpec.find === "ruin") {
    const s = obj as unknown as { pos: RoomPosition };
    if (!reachableAlive(creep, s, memberSpec.requireReachableAlive)) return null;
  }
  // A locked dropped/tombstone/ruin pile must release once another creep drains it to nothing — the
  // object itself keeps resolving (a tombstone/ruin persists, decaying, until its timer runs out; a
  // dropped resource actually vanishes at 0 but the same tick it hits 0 it can still resolve), so
  // without this a creep that arrives just after someone else scooped the last of it parks on the empty
  // pile forever: withdraw()/pickup() no-ops every tick, the gather step never reaches free===0, and
  // nothing ever re-searches. Mirrors findCandidates' own >0 filter for a fresh search.
  if (kind.kind === "dropped" || kind.kind === "tombstone" || kind.kind === "ruin") {
    if (energyAmount(obj) <= 0) return null;
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
  const candidates = findCandidates(creep, spec)
    .filter(c => {
      if (spec.find !== "structure" && spec.find !== "creep" && spec.find !== "friendly") return true;
      const resource = spec.find === "structure" ? spec.resource : undefined;
      if (!matchesWhere(toCandidate(c, resource), spec.where)) return false;
      if (spec.find === "structure" && !belowFillTo(toCandidate(c, resource), spec.fillTo)) return false;
      if (spec.find === "structure" && !belowRepair(toCandidate(c, resource), spec.repairBelow)) return false;
      return true;
    })
    // A hard exclusion, not a fallback-to-full-set stage like worthwhile/share below: offering the
    // creep's own death back as a candidate defeats the point, so a pool with nothing reachable alive
    // stays empty and the step falls through to whatever comes next.
    .filter(c => {
      if (spec.find !== "structure" && spec.find !== "dropped" && spec.find !== "tombstone" && spec.find !== "ruin") return true;
      return reachableAlive(creep, c as unknown as { pos: RoomPosition }, spec.requireReachableAlive);
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
    // (never happens on a "damaged" pool, but guard anyway) sorts to the back. The acting creep itself
    // always sorts first when it's in the pool (e.g. a healer's own find:"friendly"/find:"squadMate"
    // pool) — a healer that lets itself die while topping off an ally it doesn't need is a bad trade.
    const sorted = [...pool].sort((a, b) => {
      const aSelf = (a as unknown as { id?: Id<_HasId> }).id === creep.id;
      const bSelf = (b as unknown as { id?: Id<_HasId> }).id === creep.id;
      if (aSelf !== bSelf) return aSelf ? -1 : 1;
      return damageFraction(a) - damageFraction(b);
    });
    return sorted[0] ?? null;
  }
  if (prefer === "nearestDamaged") {
    // SimpleHealerRole's own use: within heal-assist range (3 — see lib/combat.ts's HEAL_ASSIST_RANGE)
    // travel cost is already ~0 (a healer can act this same tick regardless of which in-range patient it
    // picks), so severity decides there — same lowest-hits-fraction-first rule as "mostDamaged", self
    // always sorting first. Beyond that range travel time dominates, so range to the healer's OWN position
    // decides instead: a badly hurt ally across the room isn't worth a multi-tile detour past an ally
    // standing right next to the healer right now. getRangeTo (not findClosestByPath) — cheap enough to
    // run this sort every tick, same idiom "nearestToFlag" below already uses.
    const sorted = [...pool].sort((a, b) => {
      const aSelf = (a as unknown as { id?: Id<_HasId> }).id === creep.id;
      const bSelf = (b as unknown as { id?: Id<_HasId> }).id === creep.id;
      if (aSelf !== bSelf) return aSelf ? -1 : 1;
      const aPos = (a as unknown as { pos: RoomPosition }).pos;
      const bPos = (b as unknown as { pos: RoomPosition }).pos;
      const aInRange = creep.pos.getRangeTo(aPos) <= HEAL_ASSIST_RANGE;
      const bInRange = creep.pos.getRangeTo(bPos) <= HEAL_ASSIST_RANGE;
      if (aInRange && bInRange) return damageFraction(a) - damageFraction(b);
      if (aInRange !== bInRange) return aInRange ? -1 : 1;
      return creep.pos.getRangeTo(aPos) - creep.pos.getRangeTo(bPos);
    });
    return sorted[0] ?? null;
  }
  if (prefer === "mostThreatening") {
    // Highest threat tier first; nearest-by-path breaks ties within a tier so a defender still engages
    // the closer of two equally-armed hostiles.
    const topTier = Math.max(...pool.map(threatTier));
    const inTopTier = pool.filter(o => threatTier(o) === topTier);
    return creep.pos.findClosestByPath(inTopTier) ?? inTopTier[0] ?? null;
  }
  if (prefer === "nearestToFlag") {
    // Demolisher's own use: rank by range to the flag's LIVE position (dragging the flag in the client
    // re-sorts priority on the next tick), not the creep's own position — a structure sitting right on
    // the flag is worth clearing first regardless of which one the creep happens to be closest to right
    // now. Falls back to plain "nearest" whenever the flag is unset or has been removed, same as
    // moveToFlagStep's own fallback. Reads the same CreepMemory.followFlag every flag-following role's
    // moveToFlag step reads — not a Demolisher-specific field.
    const flag = creep.memory.followFlag ? Game.flags[creep.memory.followFlag] : undefined;
    if (!flag) return creep.pos.findClosestByPath(pool) ?? pool[0] ?? null;
    const sorted = [...pool].sort(
      (a, b) =>
        flag.pos.getRangeTo((a as unknown as { pos: RoomPosition }).pos) -
        flag.pos.getRangeTo((b as unknown as { pos: RoomPosition }).pos)
    );
    return sorted[0] ?? null;
  }
  return creep.pos.findClosestByPath(pool) ?? pool[0] ?? null;
}

// Ranks a hostile by how much it can hurt the defender, highest first: an ATTACK/RANGED_ATTACK body is
// the actual threat and must be engaged before anything else, a HEAL-only body is next (left alive it
// undoes the defender's damage on its attacker), and an unarmed body (scout, claimer) is last — never
// worth diverting fire from either. Ties within a tier (e.g. two attackers) fall through to nearest-by-path.
function threatTier(o: RoomObject): number {
  const c = o as unknown as Creep;
  if (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0) return 2;
  if (c.getActiveBodyparts(HEAL) > 0) return 1;
  return 0;
}

// Raw damage-per-tick a creep deals at melee/ranged range, ignoring the target's own TOUGH boost (no
// scout-level vision into a hostile's boosts, and the comparison only needs to be a reasonable estimate,
// not exact combat math) — melee (ATTACK) and ranged (RANGED_ATTACK) both count, since either body shape
// must be weighed the same way for this "can it actually win" check. Missing getActiveBodyparts (a
// non-combat test fixture, e.g. collectorCreep, that never carries body parts at all) reads as 0 dps
// rather than throwing.
function dpsOf(c: Creep): number {
  if (typeof c.getActiveBodyparts !== "function") return 0;
  return c.getActiveBodyparts(ATTACK) * ATTACK_POWER + c.getActiveBodyparts(RANGED_ATTACK) * RANGED_ATTACK_POWER;
}

// Ticks a hostile needs to kill `creep` outright, given its own dps — Infinity (never) if it deals none.
function ticksToKill(hostile: Creep, targetHp: number): number {
  const dps = dpsOf(hostile);
  return dps > 0 ? targetHp / dps : Infinity;
}

// True when engaging `hostile` is a losing fight for `creep`: the hostile kills the creep strictly
// faster than the creep kills the hostile — the same race a kiting ranged body wins/loses in practice,
// simplified to raw dps/effectiveHp with no range-timing model (good enough to keep a starter defender
// out of a Source Keeper lair guardian's kill zone, the concrete problem this exists for, without needing
// a full simulation). A creep with zero damage output (an unarmed scout/hauler pressed into this pool by
// mistake, or a plain test fixture with no combat stats at all) can never "win" on paper, so in principle
// it always "loses" to anything that can hurt back — but that would make every non-combat role's other
// TargetSpecs (which never route through this "hostile" case) irrelevant, and would wrongly block a test
// fixture with no `hits` field either. A creep with no `hits` reading (undefined, not merely 0) is
// unassessable, not defeated — treated as never losing so callers with no combat stats at all (any
// existing non-Defender fixture) see this gate as a no-op, matching every non-fighter TargetSpec's
// pre-existing behavior. Equally toothless real creeps (0 dps vs 0 dps) still resolve to "doesn't lose"
// (Infinity < Infinity is false).
function wouldLoseTo(creep: Creep, hostile: Creep): boolean {
  if (typeof creep.hits !== "number") return false;
  const ourHp = effectiveHp(creep.hits, 1);
  // A hostile with no `hits` reading is a fixture/vision gap, not a 0-hp target — treat it as an
  // ordinary full-health body (mirrors ourHp's own no-reduction default) rather than letting an
  // undefined propagate into NaN and silently pass every comparison below.
  const theirHp = effectiveHp(typeof hostile.hits === "number" ? hostile.hits : 100, 1);
  const theyKillUsIn = ticksToKill(hostile, ourHp);
  const weKillThemIn = ticksToKill(creep, theirHp);
  return theyKillUsIn < weKillThemIn;
}

// Energy a candidate holds, across the two shapes a gather pool mixes: dropped Resources expose
// `.amount`, store-holders (containers, tombstones, ruins) expose `.store`. Used to rank a "largest" pool
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

// True when the room's controller is reserved by anyone but us — a reservation by anyone else blocks
// harvest() on every source in the room (ERR_NOT_ENOUGH_RESOURCES's sibling, ERR_NOT_OWNER), whether a
// hostile player or the Invader faction (spawned in by an invader core). controller.my is false for a
// room we merely reserve (not own) — a remote we ourselves reserve via our own Claimer is exactly the
// non-hostile case this must NOT flag, so the check compares reservation.username against the passed-in
// creep's own owner (creeps we control are always ours), not controller.my.
function hostileReserved(creep: Creep, room: Room): boolean {
  const controller = room.controller;
  const reservation = controller?.reservation;
  return !!reservation && reservation.username !== creep.owner.username;
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

// Rooms bordering `room` that we currently have vision into (Game.rooms[name] only exists with vision) —
// the pool alsoAdjacentRooms draws from. Game.map.describeExits is a per-call lookup (no BFS, no caching
// needed here): only immediate neighbors are ever considered, not a wider frontier like scouting's own
// scoutCandidatesAround.
function adjacentVisibleRooms(room: Room): Room[] {
  const exits = Game.map.describeExits(room.name);
  if (!exits) return [];
  const out: Room[] = [];
  for (const dir in exits) {
    const neighbor = Game.rooms[exits[dir as ExitKey]!];
    if (neighbor) out.push(neighbor);
  }
  return out;
}

// Re-runs a same-room finder against every adjacent visible room and pools the results — the fallback
// half of alsoAdjacentRooms (see its doc in types.ts). `find` is one of the plain FIND_* calls used below
// (dropped/tombstone/ruin/structure), never source/creep/etc — those never carry alsoAdjacentRooms.
function findInAdjacentRooms<T extends RoomObject>(creep: Creep, find: (room: Room) => T[]): T[] {
  return adjacentVisibleRooms(creep.room).flatMap(find);
}

function findCandidates(
  creep: Creep,
  spec: Exclude<TargetSpec, { find: "id" } | { find: "controller" } | { find: "any" }>
): RoomObject[] {
  const room = creep.room;
  switch (spec.find) {
    case "source": {
      // A controller reserved by anyone but us (a hostile player, or the Invader faction via an
      // invader core) blocks harvest() outright — ERR_NOT_OWNER every tick, forever, with the source
      // never depleting to reveal the failure any other way. Excluding it from the pool here (rather
      // than letting harvestStep call and ignore the error) means the step reports "nothing to
      // resolve" and runOne's retry loop falls through to whatever's next (e.g. a settler's dismantle
      // step) instead of the creep parking on a call that can never succeed.
      if (hostileReserved(creep, room)) return [];
      const sources = room.find(FIND_SOURCES).filter(s => s.energy > 0);
      // An assigned miner harvests only its source — mining.ts's per-source WORK accounting depends on it.
      const assigned = creep.memory.sourceId;
      if (assigned === undefined) return sources;
      return sources.filter(s => s.id === assigned);
    }
    case "mineral": {
      // No hostile-reservation check (unlike source): a mineral's extractor isn't gated by controller
      // reservation. mineralAmount > 0 excludes a depleted-and-regenerating deposit, mirroring source's
      // energy > 0 filter — a mineral has no separate "temporarily empty" case worth distinguishing from
      // ordinary depletion (see types.ts's find:"mineral" doc).
      const minerals = room.find(FIND_MINERALS).filter(m => m.mineralAmount > 0);
      const assigned = creep.memory.mineralId;
      if (assigned === undefined) return minerals;
      return minerals.filter(m => m.id === assigned);
    }
    case "dropped": {
      const local = room.find(FIND_DROPPED_RESOURCES);
      if (local.length > 0 || !spec.alsoAdjacentRooms) return local;
      return findInAdjacentRooms(creep, r => r.find(FIND_DROPPED_RESOURCES));
    }
    case "tombstone": {
      const local = room.find(FIND_TOMBSTONES).filter(t => t.store.getUsedCapacity() > 0);
      if (local.length > 0 || !spec.alsoAdjacentRooms) return local;
      return findInAdjacentRooms(creep, r => r.find(FIND_TOMBSTONES).filter(t => t.store.getUsedCapacity() > 0));
    }
    case "ruin": {
      const local = room.find(FIND_RUINS).filter(r => r.store.getUsedCapacity() > 0);
      if (local.length > 0 || !spec.alsoAdjacentRooms) return local;
      return findInAdjacentRooms(creep, rm => rm.find(FIND_RUINS).filter(r => r.store.getUsedCapacity() > 0));
    }
    case "hostile":
      // A fighter must never be handed a target it would predictably lose to (a Source Keeper's lair
      // guardian is the concrete case — its body outguns any early defender/attacker — but this is a
      // plain strength comparison, not an owner check, so it also covers any other overtuned hostile).
      // Losing here means initiating: a defender/attacker that's already being shot at by something
      // still fights back via nearbyMeleeThreat/kiting in interpreter.ts, which this pool exclusion
      // never touches — only which target gets PICKED to walk toward and attack first.
      return room.find(FIND_HOSTILE_CREEPS).filter(h => !wouldLoseTo(creep, h));
    case "hostileStructure":
      // FIND_HOSTILE_STRUCTURES includes a hostile-owned/reserved room's controller — creep.attack()
      // rejects a StructureController outright (ERR_INVALID_TARGET; only attackController touches one,
      // which needs a CLAIM part this ATTACK/TOUGH/MOVE body never carries), so an attacker locking onto
      // it would just sit there forever doing nothing. Confirmed live: a hostile room's controller was
      // resolving as a valid hostileStructure target. It also includes a Source Keeper room's
      // STRUCTURE_KEEPER_LAIR (Source Keeper is a hostile NPC owner too) — attacking a lair is pointless
      // (it just respawns its guardian) and an attacker sent into an SK room this way has no business
      // fighting the actual keeper monster, so lairs are excluded the same way the controller is.
      // Confirmed live: attacker_W47N14_73031997 locked onto a keeperLair in W46N14 instead of the
      // level-0 invader core that justified the room-level attack sponsorship in the first place.
      // Under an active safe mode the room's owner is fully protected — dismantle()/attack() still
      // resolve a target and "fire" every tick (didAct stays true) but deal no damage, so a demolisher/
      // bait tower locked onto one never makes any real progress and never falls through to anything
      // else either. Confirmed live: a demolisher stuck permanently re-running step 2 (dismantle) against
      // a target room that had gone into safe mode. Emptying the pool while safeMode is active makes
      // resolveTarget report "nothing to do" instead, same as the room having no hostile structures at all.
      return room.controller?.safeMode
        ? []
        : room
            .find(FIND_HOSTILE_STRUCTURES)
            .filter(s => s.structureType !== STRUCTURE_CONTROLLER && s.structureType !== STRUCTURE_KEEPER_LAIR);
    case "hostileConstructionSite":
      return room.find(FIND_HOSTILE_CONSTRUCTION_SITES);
    case "constructionSite": {
      const sites = room.find(FIND_MY_CONSTRUCTION_SITES).filter(s => spec.structureType === undefined || s.structureType === spec.structureType);
      return sites.filter(s => nearMatches(creep, s, spec.near) && withinCarryRange(creep, s, spec.onlyIfCarryOver));
    }
    case "structure": {
      const wantedTypes = Array.isArray(spec.type) ? spec.type : [spec.type];
      const matching = (r: Room): Structure[] => r.find(FIND_STRUCTURES).filter(s => wantedTypes.includes(s.structureType));
      const local = matching(room).filter(s => nearMatches(creep, s, spec.near));
      if (local.length > 0 || !spec.alsoAdjacentRooms) return local;
      // near is a home-controller-relative filter (assignedSource/controller/notController) that only
      // makes sense against the creep's OWN room; a neighbor room's structures never carry it, same as
      // every other alsoAdjacentRooms fallback here pools raw finds with no positional narrowing.
      return findInAdjacentRooms(creep, matching);
    }
    case "creep": {
      // Never the actor itself — a creep transferring to itself is a no-op.
      const wanted = Array.isArray(spec.role) ? spec.role : [spec.role];
      return room
        .find(FIND_MY_CREEPS)
        .filter(c => c.id !== creep.id && c.memory.role !== undefined && wanted.includes(c.memory.role as never));
    }
    case "squadMate":
      // Unlike "creep" above, the acting creep IS included — a healer can target itself (see ADR 0006's
      // "squad membership is derived, not stored": every creep sharing the same memory.op, full stop).
      return room.find(FIND_MY_CREEPS).filter(c => c.memory.op !== undefined && c.memory.op === creep.memory.op);
    case "friendly":
      // Every owned creep in the room, role/op unscoped, self included — SimpleHealer's room-wide pool.
      return room.find(FIND_MY_CREEPS);
  }
}
