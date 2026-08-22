// Supply's self-registration + selection (gh #50, ADR 0008/PRD "Pool topology"): the cheap, energy-only,
// tier-first-then-nearest fast path for spawn/extension/tower — mirrors Overmind's TransportRequestGroup/
// Queen split, which also skips rate math for local refills. Deliberately NOT LogisticsRequest (request.ts,
// gh #46): that type carries dAmountdt/multiplier fields whose whole purpose is rate scoring
// (multiplier * amount / distance), and Supply's pool is defined by NOT doing rate math — reusing the
// rate-shaped type here would leave two fields permanently unused/misleading on every SupplyRequest and
// invite a future reader to wonder why Supply never sets them. SupplyRequest is a leaner, dedicated type:
// target + wanted amount + a tier number, ranked tier-first-then-nearest by pickSupplyRequest below, never
// by a computed rate. Self-registration reads live Game.* state directly (no ColonySnapshot indirection),
// same as register.ts's registerMinerContainerOutput.
//
// Scope stays exactly what graph.ts's (now-dead) supplyConsumers() used to cover: spawn/extension (one
// aggregate tier) and tower — never the controller container, storage, minerals, or a remote-room
// structure. Those remain Transport's (or Steward's) job. Live as of gh #53: driven each tick by
// behaviors/supplyTaskRunner.ts's runSupplyTask, itself dispatched from empire/creeps.ts for every
// role==="supply" creep — this module's own registration/selection logic is unchanged from gh #50.

/** One spawn/extension/tower's outstanding energy need — Supply's own request shape, no rate math. */
export interface SupplyRequest {
  target: StructureSpawn | StructureExtension | StructureTower;
  /** Free capacity right now — how much this target can still receive. */
  wanted: number;
  /** Selection tier: lower number wins ties against a higher one, checked before distance. */
  tier: number;
}

// Tower and spawn/extension share one base tier: a topped-off tower isn't worth detouring a creep past a
// starved spawn for, so ordinary tower top-off competes on distance like everything else. A tower only
// jumps the queue once it's actually running low (see TOWER_LOW_FRACTION below) — an empty tower during
// an attack is worse than a spawn/extension shortfall, but a merely-not-full one isn't. Lower number =
// higher priority, so pickSupplyRequest's tier-first comparison is a plain numeric min.
export const SUPPLY_TIER = {
  towerLow: 0,
  base: 1
} as const;

/** A tower at or below this fraction of capacity is promoted to the higher-priority tier. */
export const TOWER_LOW_FRACTION = 0.5;

/**
 * Registers every spawn/extension in `room` with free energy capacity as SupplyRequests, at the
 * spawnSystem tier — the hatchery-side registration this ticket adds (no hatchery.ts module exists yet;
 * spawn/extension ownership lives here, next to Supply's own pool, rather than invented as a new module
 * standing in for a colony concept this codebase doesn't have yet).
 */
export function registerSpawnSystemRequests(room: Room): SupplyRequest[] {
  const out: SupplyRequest[] = [];
  const structures = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION
  }) as (StructureSpawn | StructureExtension)[];
  for (const s of structures) {
    const wanted = s.store.getFreeCapacity(RESOURCE_ENERGY);
    if (wanted <= 0) continue;
    out.push({ target: s, wanted, tier: SUPPLY_TIER.base });
  }
  return out;
}

/**
 * Registers every tower in `room` with free energy capacity as SupplyRequests. A tower at or below
 * TOWER_LOW_FRACTION of capacity is promoted to the higher-priority tier (it needs the energy urgently,
 * e.g. mid-attack); otherwise it competes at the same base tier as spawn/extension, nearest-first.
 */
export function registerTowerRequests(room: Room): SupplyRequest[] {
  const out: SupplyRequest[] = [];
  const towers = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_TOWER
  }) as StructureTower[];
  for (const t of towers) {
    const wanted = t.store.getFreeCapacity(RESOURCE_ENERGY);
    if (wanted <= 0) continue;
    const capacity = t.store.getCapacity(RESOURCE_ENERGY) ?? 0;
    const low = capacity > 0 && t.store.getUsedCapacity(RESOURCE_ENERGY) <= capacity * TOWER_LOW_FRACTION;
    out.push({ target: t, wanted, tier: low ? SUPPLY_TIER.towerLow : SUPPLY_TIER.base });
  }
  return out;
}

/** Every live spawn/extension/tower energy need in `room` — Supply's whole pool, nothing else. */
export function registerSupplyRequests(room: Room): SupplyRequest[] {
  return [...registerTowerRequests(room), ...registerSpawnSystemRequests(room)];
}

/**
 * Tier-first-then-nearest selection, no rate math: the lowest tier number present wins outright; among
 * ties at that tier, the request nearest `from` wins. `rangeTo` is injected (rather than this module
 * calling creep.pos.getRangeTo itself) so the selection logic stays a plain function over data, testable
 * without a live creep. Undefined when `requests` is empty.
 */
export function pickSupplyRequest(
  requests: readonly SupplyRequest[],
  from: RoomPosition,
  rangeTo: (target: SupplyRequest["target"]) => number = target => from.getRangeTo(target)
): SupplyRequest | undefined {
  let best: SupplyRequest | undefined;
  let bestRange = Infinity;
  for (const request of requests) {
    if (best) {
      if (request.tier > best.tier) continue; // a worse tier never wins, regardless of distance
      if (request.tier === best.tier) {
        const range = rangeTo(request.target);
        if (range >= bestRange) continue;
        best = request;
        bestRange = range;
        continue;
      }
    }
    // First candidate, or a strictly better tier than the current best: takes over outright.
    best = request;
    bestRange = rangeTo(request.target);
  }
  return best;
}
