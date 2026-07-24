// The metrics capability: what a colony looks like right now, collected into one plain report.
// Pure over its inputs, unit-testable without Game; rendering is a separate concern (metricsVisual.ts).
// Harvest rate is the one stored exception — see harvestRate() for why a window, not a running total.

import type { PlacedStructure } from "../layouts/stamp";
import type { RoleName } from "../memory/schema";
import type { ColonyMetricsMemory } from "../memory/schema";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";

export const HARVEST_WINDOW = 300; // ticks of source-energy history kept; matches ENERGY_REGEN_TIME

/** One role's staffing: how many are alive now versus how many the colony's operations asked for. */
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
    harvestPerTick?: number; // realized income over the persisted window; undefined until 2 samples exist
  };
  controller: {
    level: number;
    progress: number;
  };
  construction: {
    remaining: number; // total work left across all sites; 0 when nothing is building
  };
  safeMode: {
    active: number; // ticks remaining, 0 when not active
    count: number; // activations banked for later
    available: boolean;
  };
  spawns: {
    total: number;
    busy: number; // spawning a creep this tick
  };
}

// Desired = alive now + deficit from requests() (requests report the deficit, not a target).
function censusFor(snapshot: ColonySnapshot, requests: CreepRequest[]): CensusRow[] {
  const current: Partial<Record<RoleName, number>> = {};
  for (const c of snapshot.creeps) current[c.role] = (current[c.role] ?? 0) + 1;

  const wanted: Partial<Record<RoleName, number>> = {};
  for (const r of requests) {
    const role = r.memory.role;
    wanted[role] = (wanted[role] ?? 0) + 1;
  }

  const roles = new Set<RoleName>([
    ...(Object.keys(current) as RoleName[]),
    ...(Object.keys(wanted) as RoleName[])
  ]);

  return [...roles]
    .map(role => ({ role, current: current[role] ?? 0, desired: (current[role] ?? 0) + (wanted[role] ?? 0) }))
    .sort((a, b) => b.desired - a.desired || a.role.localeCompare(b.role));
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

/** Collect one colony's metrics. `mem` is the persisted harvest window, mutated in place (the only side effect). */
export function collectMetrics(
  snapshot: ColonySnapshot,
  requests: CreepRequest[],
  operationNames: string[],
  targeted: readonly PlacedStructure[],
  mem: ColonyMetricsMemory
): ColonyMetrics {
  return {
    room: snapshot.name,
    tick: snapshot.tick,
    census: censusFor(snapshot, requests),
    operations: operationNames,
    buildings: buildingsFor(snapshot.structures, targeted),
    energy: {
      available: snapshot.energyAvailable,
      capacity: snapshot.energyCapacity,
      storage: snapshot.storageEnergy,
      dropped: snapshot.drops.reduce((sum, d) => sum + d.amount, 0),
      harvestPerTick: harvestRate(mem, snapshot.tick, totalSourceEnergy(snapshot))
    },
    controller: {
      level: snapshot.controllerLevel,
      progress: snapshot.controllerProgress
    },
    construction: {
      remaining: snapshot.constructionProgress
    },
    safeMode: {
      active: snapshot.safeModeActive, // ticks remaining, 0 when not active
      count: snapshot.safeModeCount, // activations banked for later
      available: snapshot.safeModeAvailable
    },
    spawns: {
      total: snapshot.spawns.length,
      busy: snapshot.spawns.filter(s => s.busy).length
    }
  };
}
