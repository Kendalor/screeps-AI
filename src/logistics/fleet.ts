// Shared income/distance math so Mining and Logistics can't drift on what "the room's income" or
// "the haul distance" means — both size a transport fleet (hauler vs transport creep) off the same
// numbers. Mining stays the income authority in spirit; this module is just where the shared formula
// lives so neither operation duplicates the other's.

import { countPart } from "../spawn/body";
import { range, type XY } from "../lib/geometry";
import { grossHarvest } from "../mining/remoteEconomics";
import type { ColonySnapshot, SnapCreep, SnapRemoteSource, SnapSource } from "../snapshot/types";

export interface IncomeConfig {
  sourceRegenPerTick: number;
  roomIncomeCap: number;
  defaultHaulDistance: number;
}

interface SourceBucket {
  income: number; // energy/tick actually flowing, already clamped to what the source(s) can regen
  distance: number; // one-way tiles from source to drop-off
}

// Is a creep assigned to one of the selected remote sources? An array + === check rather than a
// Set<Id<Source>>, since memory reads come back DeepReadonly-wrapped (see snapshot/types.ts) and don't
// structurally match a plain Id<Source> closely enough for Set.has's assignability check — equality
// comparison (used throughout mining.ts for the same field) tolerates it fine.
function isOnRemoteSource(sourceId: SnapCreep["memory"]["sourceId"], remotes: readonly SnapRemoteSource[]): boolean {
  return sourceId !== undefined && remotes.some(r => r.id === sourceId);
}

// Local sources' WORK, pooled exactly as before remote mining existed: every miner NOT assigned to a
// selected remote source counts as local, including creeps predating stage 2 / general-pool miners with
// no sourceId at all (PRD §6) — a remote source only ever gets credit for a miner explicitly on it.
function localBucket(miners: readonly SnapCreep[], colony: ColonySnapshot, config: IncomeConfig, off: XY | null): SourceBucket {
  const workParts = miners.reduce((sum, c) => {
    return isOnRemoteSource(c.memory.sourceId, colony.remoteSources) ? sum : sum + countPart(c.body, WORK);
  }, 0);
  const raw = workParts * HARVEST_POWER;
  const regenCap = Math.min(config.roomIncomeCap, colony.sources.length * config.sourceRegenPerTick);

  let distance = config.defaultHaulDistance;
  if (off && colony.sources.length > 0) {
    const total = colony.sources.reduce((sum: number, source: SnapSource) => {
      const spot = colony.sourceMemory[source.id]?.spot ?? source;
      return sum + range(off, spot);
    }, 0);
    distance = Math.max(1, Math.round(total / colony.sources.length));
  }

  return { income: Math.min(raw, regenCap), distance };
}

// One bucket per selected remote source, priced individually and additively on top of local — the
// reason a far or extra remote source raises the fleet's demand instead of being absorbed into the
// local cap/average. Distance is the cached route length pickRemotes/mining.ts already recorded (see
// mining/distance.ts), never a live re-path.
function remoteBuckets(miners: readonly SnapCreep[], remotes: readonly SnapRemoteSource[]): SourceBucket[] {
  return remotes.map(source => {
    const workParts = miners.reduce((sum, c) => (c.memory.sourceId === source.id ? sum + countPart(c.body, WORK) : sum), 0);
    return { income: Math.min(workParts * HARVEST_POWER, grossHarvest(source.reserved)), distance: source.distance };
  });
}

/**
 * Harvestable income right now: local sources (pooled, capped as before remote mining existed) plus
 * every staffed remote source (priced individually against its own reserved/unreserved regen cap, see
 * mining/remoteEconomics.ts's grossHarvest). Takes the miner list rather than filtering the snapshot
 * itself so each caller controls ownership-scoping (Mining.owned() vs. a colony-wide read).
 */
export function harvestIncome(miners: readonly SnapCreep[], colony: ColonySnapshot, config: IncomeConfig): number {
  const local = localBucket(miners, colony, config, dropOff(colony));
  const remotes = remoteBuckets(miners, colony.remoteSources);
  return local.income + remotes.reduce((sum, b) => sum + b.income, 0);
}

/** Where energy is delivered: storage if built, else the anchor. Null before either exists. */
export function dropOff(colony: ColonySnapshot): XY | null {
  if (colony.storageId) {
    const storage = colony.structures.find(s => s.type === "storage");
    if (storage) return { x: storage.x, y: storage.y };
  }
  return colony.anchor;
}

/**
 * Income-weighted mean distance from source to drop-off: the local pool (unweighted average across
 * local sources, exactly as before remote mining existed — there's nothing to weight it by since local
 * income isn't split per source) blended with every staffed remote source, each weighted by its own
 * clamped income. Weighting by income means `harvestIncome(...) * 2 * haulDistance(...)` reduces to the
 * exact sum of each staffed source's own (income x round trip) — a far, low-yield remote can't drag the
 * fleet's round trip as far as a nearby high-yield one would.
 */
export function haulDistance(miners: readonly SnapCreep[], colony: ColonySnapshot, config: IncomeConfig): number {
  const local = localBucket(miners, colony, config, dropOff(colony));
  const remotes = remoteBuckets(miners, colony.remoteSources);

  const totalIncome = local.income + remotes.reduce((sum, b) => sum + b.income, 0);
  if (totalIncome <= 0) return config.defaultHaulDistance;

  const weightedSum = local.income * local.distance + remotes.reduce((sum, b) => sum + b.income * b.distance, 0);
  return Math.max(1, weightedSum / totalIncome);
}

