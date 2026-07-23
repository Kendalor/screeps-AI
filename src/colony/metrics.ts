// The metrics capability: what a colony looks like right now, collected into one plain report.
//
// Pure over its inputs — a ColonySnapshot, the colony's own spawn demand, and the persisted
// harvest window — so the whole thing is unit-testable without Game. It reads no live objects and
// makes no game calls; rendering the report to the room is a separate, execute-side concern
// (see metricsVisual.ts + the roomVisual intent).
//
// Almost everything here is derived fresh from the snapshot each tick and never stored. The one
// exception is harvest rate: a rate needs two points in time, so a short window of samples is kept
// in Memory (ColonyMetricsMemory) and folded here. See harvestRate() for why a window, not a
// running total.

import type { PlacedStructure } from "../layouts/stamp";
import type { RoleName } from "../memory/schema";
import type { ColonyMetricsMemory } from "../memory/schema";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";

// How many ticks of source-energy history to keep. Wide enough that the rate averages over a full
// source drain/regen swing rather than jittering tick to tick; short enough that a stale sample
// (e.g. after a vision gap) ages out within a source's regen period. ENERGY_REGEN_TIME is 300.
export const HARVEST_WINDOW = 300;

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
  // Per-role staffing, only for roles that are either present or wanted — a role at 0/0 is noise.
  census: CensusRow[];
  // The operations this colony owns, by their `name` (kind:room). The list the goal asks to see.
  operations: string[];
  // Per structure-type build progress at the current RCL: how many are up vs. how many the plan
  // wants. Types with a nonzero target *or* something built are shown; a type not yet unlocked and
  // not built is omitted.
  buildings: BuildingRow[];
  energy: {
    // In the spawn/extension network right now, and its cap — the "can I afford a body" number.
    available: number;
    capacity: number;
    storage: number; // 0 before storage is built
    dropped: number; // total energy sitting on the ground (drop-mining piles, spillage)
    // Average energy harvested per tick over the persisted window, or undefined until there are two
    // samples to diff. This is realized income — source energy that actually left the sources.
    harvestPerTick?: number;
  };
  controller: {
    level: number;
    progress: number;
  };
  construction: {
    remaining: number; // total work left across all sites; 0 when nothing is building
  };
  // Ticks of safe mode left if active; 0 when not in safe mode. Whether one is available to trigger
  // is a separate flag the snapshot already carries.
  safeMode: {
    active: number; // ticks of safe mode left; 0 when not active
    count: number; // activations banked for later use
    available: boolean; // whether one can be triggered right now
  };
  spawns: {
    total: number;
    busy: number; // spawning a creep this tick
  };
}

// Desired staffing per role = who is alive now + who the operations still want. requests() reports
// the *deficit* (missing creeps), not a target, so the target is current + deficit. This is exact:
// an operation that is fully staffed emits no requests and desired collapses to current.
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

// Built vs. targeted, per structure type. `built` is what stands in the room now; `targeted` is the
// current-RCL plan (colony/building.ts's wantedStructures). A type appears if either count is > 0,
// so an unbuilt-but-planned type shows 0/N (the backlog) and a built-but-no-longer-planned type
// shows N/0 (e.g. a structure kept past its RCL). Sorted most-remaining first so the panel leads
// with what still needs building.
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

// The total energy standing in the room's sources this tick — the quantity whose fall over time is
// harvest. Summed here so both the sampler and any test speak in the same terms.
function totalSourceEnergy(snapshot: ColonySnapshot): number {
  // The snapshot does not carry live source energy (SnapSource is position + open tiles only), so
  // harvest rate is measured at the *destination* instead: containers plus storage plus ground
  // drops. Their combined rise is energy that entered the economy — i.e. was harvested — before any
  // sink spent it. See harvestRate() for how the diff becomes a rate.
  const containers = snapshot.containers.reduce((sum, c) => sum + c.storeEnergy, 0);
  const dropped = snapshot.drops.reduce((sum, d) => sum + d.amount, 0);
  return containers + dropped + snapshot.storageEnergy;
}

// Fold this tick's sample into the persisted window and return the resulting average harvest/tick.
//
// Rate = (newest stored energy − oldest) / (newest tick − oldest tick), but with sinks netted out
// this would read *net* accumulation, not gross harvest. So we clamp per-step: only ticks where the
// stored total rose count toward harvest; ticks where it fell (a sink drained it) contribute zero,
// not negative. Averaged over the window's tick span, that is a stable income estimate that does not
// swing negative every time an upgrader empties a container.
function harvestRate(mem: ColonyMetricsMemory, tick: number, sourceEnergy: number): number | undefined {
  const samples = mem.harvestSamples;
  const last = samples[samples.length - 1];

  // Only record forward-moving, distinct ticks. A re-run of the same tick (or a clock that went
  // backwards under some replay) must not create a zero-span sample that divides by zero below.
  if (!last || tick > last.tick) {
    samples.push({ tick, sourceEnergy });
    // Drop anything older than the window relative to the newest sample.
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

/**
 * Collect one colony's metrics. `requests` is the colony's own spawn demand (colony.requests()),
 * used to turn "who is alive" into "who is wanted". `operationNames` is colony.operations mapped to
 * their names. `targeted` is the current-RCL structure plan (colony.building's wantedStructures),
 * computed by the caller so this stays pure. `mem` is the persisted harvest window, mutated in place
 * (the only side effect).
 */
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
