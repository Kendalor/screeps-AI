// Miner and hauler quotas.

import { countPart } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";

const MIN_HAULER_ENERGY = 150; // one CARRY,CARRY,MOVE set — the cheapest body

// Asks the role table rather than restating its formula, so the quota tracks any change to the miner body automatically.
function minerWorkParts(colony: ColonySnapshot): number {
  const body = roleDef("miner")?.body(colony.energyCapacity, { hasContainer: false, hasLink: false }) ?? [];
  return Math.max(1, countPart(body, WORK));
}

// A source yields 10 energy/tick and one WORK harvests 2/tick (5 WORK is exact); the colony
// provisions slightly above that to cover the walk to the source and the gap between a miner
// dying and its replacement arriving.
const WORK_PER_SOURCE = 6;

export function desiredMinerCount(colony: ColonySnapshot): number {
  const workPerBody = minerWorkParts(colony);
  const wanted = colony.sources.reduce((sum, source) => {
    const forSource = Math.ceil(WORK_PER_SOURCE / workPerBody);
    return sum + Math.min(forSource, source.openTiles);
  }, 0);

  // Cold-start seed: hauler demand derives from miner output, so zero miners means zero
  // hauler demand and this quota would never ask for the first one. Scoped to "no haulers
  // alive" so it lapses once one exists and doesn't cause over-mining later. See ADR 0001.
  const haulers = colony.census.hauler ?? 0;
  if (haulers === 0) return colony.sources.length > 0 ? 1 : 0;

  // Only haulers count toward collector capacity — bootstraps are deliberately excluded so
  // bootstrap's own quota (defined in terms of every other role's deficit) cannot chase this
  // one upward. See ADR 0001.
  return Math.min(wanted, haulers);
}

export function desiredHaulerCount(colony: ColonySnapshot): number {
  if (colony.energyCapacity < MIN_HAULER_ENERGY) return 0;
  return colony.containers.filter(c => c.storeEnergy > 0).length;
}
