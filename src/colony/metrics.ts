// The metrics capability: what a colony looks like right now, collected into one plain report.
// Pure over its inputs, unit-testable without Game; rendering is a separate concern (metricsVisual.ts).
// Harvest rate is the one stored exception — see harvestRate() for why a window, not a running total.

import { roleDef } from "../behaviors/roles";
import type { PlacedStructure } from "../layouts/stamp";
import { needsRepair, REPAIRABLE } from "../lib/repairable";
import type { RoleName } from "../memory/schema";
import type { ColonyMetricsMemory } from "../memory/schema";
import type { RoleTarget } from "../operations/operation";
import type { ColonySnapshot, SnapRemoteSource, SnapStructure } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";

export const HARVEST_WINDOW = 300; // ticks of source-energy history kept; matches ENERGY_REGEN_TIME

/**
 * One role's staffing: how many are alive now versus how many the colony's operations target. `desired`
 * is the true target, so it can sit *below* `current` — an over-staffed role (5 builders alive, nothing
 * left to build) reads `5/0`, not `5/5`. See `censusFor` for how the target is sourced.
 */
export interface CensusRow {
  role: RoleName;
  current: number;
  desired: number;
}

/** One structure type's build progress: how many stand versus how many the current-RCL plan targets. */
export interface BuildingRow {
  type: BuildableStructureConstant;
  built: number;
  targeted: number;
}

/** One remote room's repair upkeep, for the debug panel's per-room breakdown (see repairRemainingFor). */
export interface RemoteRepairRow {
  room: string;
  decay: number;
  actionable: number;
}

/** One selected remote source, for the debug panel's reservation status. */
export interface RemoteSourceRow {
  room: string;
  reserved: boolean;
  danger: boolean;
}

/** Optional, off-by-default detail beyond the always-on panel — see setDebugMetrics in commands/console.ts. */
export interface DebugMetrics {
  remoteRepair: RemoteRepairRow[]; // rooms with any decay at all, worst-first
  remoteSources: RemoteSourceRow[]; // every currently-selected remote source
}

export interface ColonyMetrics {
  room: string;
  tick: number;
  census: CensusRow[]; // roles present or wanted; a role at 0/0 is noise, omitted
  operations: string[]; // this colony's operations, by name (kind:room)
  buildings: BuildingRow[]; // build progress at current RCL; unlocked-and-unbuilt types omitted
  energy: {
    available: number; // in the spawn/extension network right now
    capacity: number; // the "can I afford a body" ceiling
    storage: number; // 0 before storage is built
    dropped: number; // total energy sitting on the ground
    remoteEnergy: number; // energy sitting in remote rooms (containers/drops/tombstones) awaiting haul-home
    harvestPerTick?: number; // realized income over the persisted window; undefined until 2 samples exist
  };
  controller: {
    level: number;
    progress: number;
    progressTotal: number; // progress to the next level; 0 at max RCL. progressTotal - progress = work left
  };
  construction: {
    remaining: number; // home-room build points left across all sites; 0 when nothing is building. 1 point = 1 energy
    // Same, but for this colony's selected remote rooms — additive, not included in `remaining` (same
    // split as energy.remoteEnergy vs energy.dropped). Vision-independent: a remote site's progress is
    // known from Game.constructionSites even on a tick its room isn't visible.
    remoteRemaining: number;
  };
  repair: {
    // Total hits of decay across all repairable structures below 100% — visible upkeep, shown before it
    // reaches the repairer's action floor. 1 energy per REPAIR_POWER (100) hits. Home room only.
    decay: number;
    // The subset of that decay past the repair floor (REPAIR_BELOW) — the hits a repairer would actually
    // be dispatched to restore. <= decay; 0 while everything is above the floor even if some has decayed.
    actionable: number;
    // Same two figures, but for this colony's selected remote rooms — additive, not included in
    // decay/actionable above. Only ever non-zero for a remote room we currently have vision of (same
    // vision rule as remoteEnergy/remoteSources); a remote miner already self-repairs its own container,
    // so this mostly surfaces road decay nobody is dispatched to fix yet.
    remoteDecay: number;
    remoteActionable: number;
  };
  safeMode: {
    active: number; // ticks remaining, 0 when not active
    count: number; // activations banked for later
    available: boolean;
  };
  spawns: {
    total: number;
    busy: number; // spawning a creep this tick
    // Steady-state spawn load as a colony-level fraction, so it stays comparable as spawn count grows.
    // Keeping one body part alive costs a spawn CREEP_SPAWN_TIME/CREEP_LIFE_TIME = 1/500 of its output,
    // so utilisation = required parts / (spawns * 500). >= 1 means spawns can't keep the population alive.
    load: number; // 0..1+: parts / capacity
    parts: number; // required body parts: living creeps + outstanding requests (the load numerator)
    capacity: number; // total * PARTS_PER_SPAWN — parts these spawns can sustain
  };
  debug?: DebugMetrics; // only collected when Memory.debugMetrics is set — see collectMetrics
}

// One spawn produces one part every CREEP_SPAWN_TIME (3) ticks, and a part must be replaced every
// CREEP_LIFE_TIME (1500) ticks, so a single spawn can keep 1500/3 = 500 parts alive indefinitely.
export const PARTS_PER_SPAWN = 500;

// `desired` is the operation-reported target where one exists (operations sum across the colony), so it
// can be below `current` and surface a surplus as `N/0`. Roles no operation reports a target for fall back
// to alive + deficit-from-requests — the old denominator, correct for any role that never over-staffs.
function censusFor(snapshot: ColonySnapshot, requests: CreepRequest[], targets: RoleTarget[]): CensusRow[] {
  const current: Partial<Record<RoleName, number>> = {};
  for (const c of snapshot.creeps) current[c.role] = (current[c.role] ?? 0) + 1;

  const wanted: Partial<Record<RoleName, number>> = {};
  for (const r of requests) {
    const role = r.memory.role;
    wanted[role] = (wanted[role] ?? 0) + 1;
  }

  // Targets summed per role — two operations wanting the same role (rare) add up, matching how requests do.
  const target: Partial<Record<RoleName, number>> = {};
  for (const t of targets) target[t.role] = (target[t.role] ?? 0) + t.target;

  const roles = new Set<RoleName>([
    ...(Object.keys(current) as RoleName[]),
    ...(Object.keys(wanted) as RoleName[]),
    ...(Object.keys(target) as RoleName[])
  ]);

  return [...roles]
    .map(role => ({
      role,
      current: current[role] ?? 0,
      // Prefer the reported target; fall back to the request-derived denominator when none is reported.
      desired: target[role] ?? (current[role] ?? 0) + (wanted[role] ?? 0)
    }))
    // Default spawn priority order (roleDef), highest first; roles with no def (e.g. sitter, pioneer)
    // sort last, alphabetically among themselves.
    .sort((a, b) => (roleDef(b.role)?.priority ?? -Infinity) - (roleDef(a.role)?.priority ?? -Infinity) || a.role.localeCompare(b.role));
}

// Built vs. targeted per structure type; a type appears if either count is > 0. Sorted most-remaining first.
export function buildingsFor(built: readonly SnapStructure[], targeted: readonly PlacedStructure[]): BuildingRow[] {
  const builtBy = countByType(built);
  const targetBy = countByType(targeted);

  const types = new Set<BuildableStructureConstant>([
    ...(Object.keys(builtBy) as BuildableStructureConstant[]),
    ...(Object.keys(targetBy) as BuildableStructureConstant[])
  ]);

  return [...types]
    .map(type => ({ type, built: builtBy[type] ?? 0, targeted: targetBy[type] ?? 0 }))
    .sort(
      (a, b) =>
        b.targeted - b.built - (a.targeted - a.built) || // most still to build first
        b.targeted - a.targeted ||
        a.type.localeCompare(b.type)
    );
}

function countByType(structures: readonly { type: BuildableStructureConstant }[]): Partial<Record<BuildableStructureConstant, number>> {
  const counts: Partial<Record<BuildableStructureConstant, number>> = {};
  for (const s of structures) counts[s.type] = (counts[s.type] ?? 0) + 1;
  return counts;
}

/**
 * Two views of repairable decay, both in hits, over the same REPAIRABLE type set (walls/ramparts
 * excluded — their upkeep is a defense concern, not this). Sites (no hits) are skipped.
 *
 * - `decay`: every point below hitsMax, so upkeep is visible as it accumulates.
 * - `actionable`: the subset past the repair floor, matching `needsRepair` exactly — the hits a repairer
 *   would actually be dispatched to restore. Always <= decay.
 */
export function repairRemainingFor(structures: readonly SnapStructure[]): { decay: number; actionable: number } {
  let decay = 0;
  let actionable = 0;
  for (const s of structures) {
    if (s.hits === undefined || s.hitsMax === undefined) continue;
    if (!REPAIRABLE.includes(s.type)) continue;
    const missing = s.hitsMax - s.hits;
    if (missing <= 0) continue;
    decay += missing;
    if (needsRepair(s.type, s.hits, s.hitsMax)) actionable += missing;
  }
  return { decay, actionable };
}

// Per-room breakdown of the same decay repairRemainingFor already aggregates for the always-on panel —
// only computed when the debug panel is on, since it's a second pass over remoteStructures. Rooms with
// zero decay are omitted (matches the aggregate's "only shown once decay > 0" rule); worst decay first.
function remoteRepairFor(remoteStructures: ColonySnapshot["remoteStructures"]): RemoteRepairRow[] {
  return Object.entries(remoteStructures)
    .map(([room, structures]) => ({ room, ...repairRemainingFor(structures ?? []) }))
    .filter(row => row.decay > 0)
    .sort((a, b) => b.decay - a.decay);
}

// Every currently-selected remote source with its reservation/danger status, room-then-nearest ordered
// (matches SnapRemoteSource's own selection order — nearest-first per room).
function remoteSourcesFor(remoteSources: readonly SnapRemoteSource[]): RemoteSourceRow[] {
  return remoteSources.map(s => ({ room: s.room, reserved: s.reserved, danger: s.danger > 0 }));
}

// SnapSource carries no live energy, so harvest is measured at the destination: containers + storage + drops.
function totalSourceEnergy(snapshot: ColonySnapshot): number {
  const containers = snapshot.containers.reduce((sum, c) => sum + c.storeEnergy, 0);
  const dropped = snapshot.drops.reduce((sum, d) => sum + d.amount, 0);
  return containers + dropped + snapshot.storageEnergy;
}

// Folds this tick's sample into the window and returns the average. Per-step clamped to >=0 so a
// sink draining the pile (net decrease) reads as zero harvest, not negative.
function harvestRate(mem: ColonyMetricsMemory, tick: number, sourceEnergy: number): number | undefined {
  const samples = mem.harvestSamples;
  const last = samples[samples.length - 1];

  if (!last || tick > last.tick) { // skip replays/backwards clocks — avoids a zero-span sample
    samples.push({ tick, sourceEnergy });
    const cutoff = tick - HARVEST_WINDOW;
    while (samples.length > 1 && samples[0].tick < cutoff) samples.shift();
  }

  if (samples.length < 2) return undefined;

  let gained = 0;
  for (let i = 1; i < samples.length; i++) {
    gained += Math.max(0, samples[i].sourceEnergy - samples[i - 1].sourceEnergy);
  }
  const span = samples[samples.length - 1].tick - samples[0].tick;
  return span > 0 ? gained / span : undefined;
}

/** Collect one colony's metrics. `mem` is the persisted harvest window, mutated in place (the only side
 * effect). `debugMetrics` gates the optional `debug` block (see Memory.debugMetrics / setDebugMetrics) —
 * off by default so the always-on panel's cost doesn't grow for colonies nobody is actively debugging. */
export function collectMetrics(
  snapshot: ColonySnapshot,
  requests: CreepRequest[],
  operationNames: string[],
  targeted: readonly PlacedStructure[],
  mem: ColonyMetricsMemory,
  roleTargets: RoleTarget[] = [],
  debugMetrics = false
): ColonyMetrics {
  return {
    room: snapshot.name,
    tick: snapshot.tick,
    census: censusFor(snapshot, requests, roleTargets),
    operations: operationNames,
    // `targeted` includes remote-claimed structures (mining containers/roads), so `built` must count
    // them too or a fully-built remote container reads as permanently missing (home-only undercount).
    buildings: buildingsFor(
      [...snapshot.structures, ...Object.values(snapshot.remoteStructures).flatMap(s => s ?? [])],
      targeted
    ),
    energy: {
      available: snapshot.energyAvailable,
      capacity: snapshot.energyCapacity,
      storage: snapshot.storageEnergy,
      dropped: snapshot.drops.reduce((sum, d) => sum + d.amount, 0),
      remoteEnergy: snapshot.remoteEnergy.reduce((sum, e) => sum + e.amount, 0),
      harvestPerTick: harvestRate(mem, snapshot.tick, totalSourceEnergy(snapshot))
    },
    controller: {
      level: snapshot.controllerLevel,
      progress: snapshot.controllerProgress,
      progressTotal: snapshot.controllerProgressTotal
    },
    construction: {
      remaining: snapshot.constructionProgress,
      remoteRemaining: snapshot.remoteConstructionProgress
    },
    repair: (() => {
      const home = repairRemainingFor(snapshot.structures);
      const remote = repairRemainingFor(Object.values(snapshot.remoteStructures).flatMap(s => s ?? []));
      return { decay: home.decay, actionable: home.actionable, remoteDecay: remote.decay, remoteActionable: remote.actionable };
    })(),
    safeMode: {
      active: snapshot.safeModeActive, // ticks remaining, 0 when not active
      count: snapshot.safeModeCount, // activations banked for later
      available: snapshot.safeModeAvailable
    },
    spawns: (() => {
      const total = snapshot.spawns.length;
      // Required parts, not just living ones: what's alive plus every creep still requested to fill the
      // colony's targets. This reflects the full staffing load the spawns must sustain, so an understaffed
      // colony reads > 100% (spawns can't keep up) rather than looking idle because few creeps are alive yet.
      const livingParts = snapshot.creeps.reduce((sum, c) => sum + c.body.length, 0);
      const requestedParts = requests.reduce((sum, r) => sum + r.body.length, 0);
      const parts = livingParts + requestedParts;
      const capacity = total * PARTS_PER_SPAWN;
      return {
        total,
        busy: snapshot.spawns.filter(s => s.busy).length,
        parts,
        capacity,
        load: capacity > 0 ? parts / capacity : 0 // colony fraction; 0 when spawnless (dying colony)
      };
    })(),
    debug: debugMetrics
      ? {
          remoteRepair: remoteRepairFor(snapshot.remoteStructures),
          remoteSources: remoteSourcesFor(snapshot.remoteSources)
        }
      : undefined
  };
}
