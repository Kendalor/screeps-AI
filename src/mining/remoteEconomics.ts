// Is a remote source worth mining, and is a remote room worth reserving? Pure energy accounting over
// plain numbers — no Game.*, no snapshot mocking, same testable shape as the scout target picker.
//
// All rates are energy/tick so they compose by addition. A source is worth mining when its harvest
// yield beats the summed upkeep of the miner, the return haul, and the road+container it needs. All
// constants come from the game's BODYPART_COST / *_DECAY / CREEP_LIFE_TIME etc. — never hardcoded here,
// so a server with tweaked constants reprices correctly.

import type { SnapRemoteSource } from "../snapshot/types";

export interface EconomyContext {
  minerBodyCost: number; // energy to spawn the miner staffing one remote source
  claimerBodyCost: number; // energy to spawn one claimer (reserves a whole room)
}

// Energy a single source yields per tick: reserved rooms regen twice as fast as neutral ones.
function grossHarvest(reserved: boolean): number {
  const capacity = reserved ? SOURCE_ENERGY_CAPACITY : SOURCE_ENERGY_NEUTRAL_CAPACITY;
  return capacity / ENERGY_REGEN_TIME; // reserved => 10/tick, unreserved => 5/tick
}

// A body's spawn cost spread over its life is its steady-state energy/tick upkeep.
function amortize(bodyCost: number): number {
  return bodyCost / CREEP_LIFE_TIME;
}

// CARRY parts needed to keep `yieldPerTick` energy flowing over a round trip of `distance` tiles, priced
// as CARRY+MOVE pairs amortized over their life. Round trip is 2*distance ticks (there and back); the
// energy accumulated in that window must fit the carried capacity.
function haulUpkeep(yieldPerTick: number, distance: number): number {
  const roundTripTicks = 2 * distance;
  const energyInFlight = yieldPerTick * roundTripTicks;
  const carryParts = Math.ceil(energyInFlight / CARRY_CAPACITY);
  const pairCost = BODYPART_COST[CARRY] + BODYPART_COST[MOVE]; // one CARRY needs one MOVE to stay at road speed
  return amortize(carryParts * pairCost);
}

// Decay of the road (one segment per tile home->source) plus the drop container, converted to the energy
// it costs to repair that decay. REPAIR_POWER hits are restored per energy spent.
function roadContainerUpkeep(distance: number): number {
  const roadDecayPerTile = ROAD_DECAY_AMOUNT / ROAD_DECAY_TIME; // hits/tick per road tile
  const containerDecay = CONTAINER_DECAY / CONTAINER_DECAY_TIME; // hits/tick (remote = unowned interval)
  const hitsPerTick = roadDecayPerTile * distance + containerDecay;
  return hitsPerTick / REPAIR_POWER; // energy/tick to keep them repaired
}

// Per-source net energy/tick. Positive => worth mining at all. Negative => the haul/upkeep swamps it.
export function netEnergy(source: SnapRemoteSource, ctx: EconomyContext): number {
  const gross = grossHarvest(source.reserved);
  return gross - amortize(ctx.minerBodyCost) - haulUpkeep(gross, source.distance) - roadContainerUpkeep(source.distance);
}

// Per-ROOM: is reserving worth it? Reserving lifts every mined source in the room from 5 to 10/tick — a
// marginal +5/tick each. Worth it when the summed marginal gain beats one claimer's upkeep. So a room
// with two mined sources justifies a claimer more easily than one with a single source.
export function worthReserving(roomSources: readonly SnapRemoteSource[], ctx: EconomyContext): boolean {
  const marginalPerSource = grossHarvest(true) - grossHarvest(false); // +5/tick
  const marginalGain = marginalPerSource * roomSources.length;
  return marginalGain > amortize(ctx.claimerBodyCost);
}

// Concrete costs for the default RCL2 bodies, so tests and the selector share one baseline. A container
// miner is ~5 WORK + moves; a claimer is one CLAIM + one MOVE.
export function defaultEconomyContext(): EconomyContext {
  const minerBodyCost = 5 * BODYPART_COST[WORK] + 3 * BODYPART_COST[MOVE] + BODYPART_COST[CARRY];
  const claimerBodyCost = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];
  return { minerBodyCost, claimerBodyCost };
}
