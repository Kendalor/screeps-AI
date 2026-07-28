// Shared income/distance math so Mining and Logistics can't drift on what "the room's income" or
// "the haul distance" means — both size a transport fleet (hauler vs transport creep) off the same
// numbers. Mining stays the income authority in spirit; this module is just where the shared formula
// lives so neither operation duplicates the other's.

import { countPart } from "../spawn/body";
import { range, type XY } from "../lib/geometry";
import type { ColonySnapshot, SnapCreep, SnapSource } from "../snapshot/types";

export interface IncomeConfig {
  sourceRegenPerTick: number;
  roomIncomeCap: number;
  defaultHaulDistance: number;
}

/**
 * Harvestable income right now: given miners' WORK as energy/tick, clamped to source regen. Takes the
 * miner list rather than filtering the snapshot itself so each caller controls ownership-scoping
 * (Mining.owned() vs. a colony-wide read) — remote mining will care about that distinction.
 */
export function harvestIncome(miners: readonly SnapCreep[], colony: ColonySnapshot, config: IncomeConfig): number {
  const workParts = miners.reduce((sum: number, c: SnapCreep) => sum + countPart(c.body, WORK), 0);
  const raw = workParts * HARVEST_POWER;
  const regenCap = Math.min(config.roomIncomeCap, colony.sources.length * config.sourceRegenPerTick);
  return Math.min(raw, regenCap);
}

/** Where energy is delivered: storage if built, else the anchor. Null before either exists. */
export function dropOff(colony: ColonySnapshot): XY | null {
  if (colony.storageId) {
    const storage = colony.structures.find(s => s.type === "storage");
    if (storage) return { x: storage.x, y: storage.y };
  }
  return colony.anchor;
}

/** Mean distance from a source to where a hauler/transport unloads; flat default before an anchor exists. */
export function haulDistance(colony: ColonySnapshot, config: IncomeConfig): number {
  const off = dropOff(colony);
  if (!off || colony.sources.length === 0) return config.defaultHaulDistance;

  const total = colony.sources.reduce((sum: number, source: SnapSource) => {
    const spot = colony.sourceMemory[source.id]?.spot ?? source;
    return sum + range(off, spot);
  }, 0);
  return Math.max(1, Math.round(total / colony.sources.length));
}

