// Miner and hauler quotas (docs/rewrite-skeleton.md §9 P1) — the two halves of
// the container logistics chain. Both hang off containers: a container is what
// makes a miner worth spawning, and a filling one is what needs hauling away.

import type { ColonySnapshot } from "../snapshot/types";

const MIN_HAULER_ENERGY = 150; // one CARRY,CARRY,MOVE set — the cheapest body

// A miner only pays off once there is a container under it to catch the
// harvest — before that it fills its lone CARRY and stalls, and bootstrap
// creeps are the ones keeping the colony moving.
export function desiredMinerCount(colony: ColonySnapshot): number {
  return Math.min(colony.sources.length, colony.containers.length);
}

export function desiredHaulerCount(colony: ColonySnapshot): number {
  if (colony.energyCapacity < MIN_HAULER_ENERGY) return 0;
  return colony.containers.filter(c => c.storeEnergy > 0).length;
}
