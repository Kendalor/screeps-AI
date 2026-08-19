// Self-registration against live Game.* state (gh #46, ADR 0008's self-registration decision) — a
// deliberate, scoped departure from the rest of the planner stack's pure-function-over-ColonySnapshot
// convention, applying to src/logistics/ only (see the ADR's own scope note). Two registration sources:
// a miner's source container (gh #46) and a mineral miner's extractor container (gh #48), mirroring
// Overmind's Miner/Extractor registration asymmetry exactly (ADR 0008's "Mirror Overmind's energy-vs-
// mineral registration asymmetry exactly" section) — energy is threshold-gated with a known rate, mineral
// registers unconditionally with no rate, since it accrues in cooldown-gated bursts rather than
// continuously and a fullness gate would reproduce the exact starvation this rewrite exists to fix.

import { requestOutput, type LogisticsRequest } from "./request";

// A source container's output only becomes a request once meaningfully full — a trivial amount isn't
// worth a purpose-built trip (same reasoning as graph.ts's DROP_WORTHWHILE_FLOOR, sized instead to a
// fraction of container capacity, mirroring Overmind's own Miner.registerEnergyRequests threshold — see
// ADR 0008's registration-asymmetry section). Energy only; a mineral container has no such gate.
export const ENERGY_CONTAINER_REGISTER_THRESHOLD = 0.5;

/**
 * A source's adjacent container, if one is built — the one live-object lookup this module needs, since
 * registration reads Game.* directly rather than a ColonySnapshot's precomputed container list.
 */
function sourceContainer(source: Source): StructureContainer | undefined {
  return source.pos.findInRange(FIND_STRUCTURES, 1).find((s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER);
}

/**
 * A mineral's adjacent container, if one is built — the Extractor-side equivalent of sourceContainer,
 * used by registerMineralContainerOutput below.
 */
function mineralContainer(mineral: Mineral): StructureContainer | undefined {
  return mineral.pos.findInRange(FIND_STRUCTURES, 1).find((s): s is StructureContainer => s.structureType === STRUCTURE_CONTAINER);
}

/**
 * Registers a miner's source container's energy output as a LogisticsRequest, once it holds at least
 * `ENERGY_CONTAINER_REGISTER_THRESHOLD` of its capacity. `harvestRate` becomes the request's `dAmountdt`
 * (the source's known saturation/harvest rate — see miner.ts's SOURCE_SATURATING_WORK) so a fast source's
 * container reads as more urgent sooner, same as Overmind's own `energyPerTick` wiring. Undefined when no
 * container exists yet, or it hasn't crossed the threshold.
 */
export function registerMinerContainerOutput(source: Source, harvestRate = 0): LogisticsRequest | undefined {
  const container = sourceContainer(source);
  if (!container) return undefined;
  const stored = container.store.getUsedCapacity(RESOURCE_ENERGY);
  if (stored < container.store.getCapacity(RESOURCE_ENERGY) * ENERGY_CONTAINER_REGISTER_THRESHOLD) return undefined;
  return requestOutput(container, RESOURCE_ENERGY, stored, harvestRate);
}

/**
 * Registers a mineral miner's extractor container's output as a LogisticsRequest the instant it holds
 * ANY amount of its mineral — no threshold, no `dAmountdt` (see this module's header and ADR 0008's
 * registration-asymmetry section: mineral accrues slowly in cooldown-gated bursts, so gating it behind a
 * fullness threshold the way energy is would reproduce, in miniature, the exact starvation this whole
 * rewrite exists to fix). A trickle of mineral is expected to lose every rate race against a routine
 * energy request at first — the request only wins once starved long enough for its `amount` to grow past
 * what distance-adjusted energy scores, which is the whole point (see request.ts's scoreRequest and the
 * PRD's user story 2). Undefined when no container exists yet, or it's currently empty.
 */
export function registerMineralContainerOutput(mineral: Mineral): LogisticsRequest | undefined {
  const container = mineralContainer(mineral);
  if (!container) return undefined;
  const stored = container.store.getUsedCapacity(mineral.mineralType);
  if (stored <= 0) return undefined;
  return requestOutput(container, mineral.mineralType, stored);
}
