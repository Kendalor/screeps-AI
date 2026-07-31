// How many spawn "parts" (see colony/metrics.ts's load formula) one more remote source would cost —
// the miner it needs plus its share of the transport fleet's CARRY parts. Shared by pickRemotes (so
// selection can't over-commit the spawn) and Logistics stays the transport sizing authority in spirit;
// this is only the marginal estimate a source not yet selected would add, not a live re-sizing of the
// whole fleet.

import { orderBody } from "../spawn/body";
import type { BodyContext } from "../behaviors/types";
import { roleDef } from "../behaviors/roles";
import { grossHarvest } from "./remoteEconomics";

const config = {
  energyPerCarry: 50, // one CARRY part — mirrors operations/logistics.ts
  carryMargin: 1.2 // mirrors operations/logistics.ts's over-provisioning factor
} as const;

/** The miner body a candidate source would spawn, sized exactly as Mining's own remote request would. */
export function remoteMinerBody(energyCapacity: number, reserved: boolean): BodyPartConstant[] {
  const ctx: BodyContext = { hasContainer: false, hasLink: false, remote: true, reserved };
  return orderBody(roleDef("miner")?.body(energyCapacity, ctx) ?? []);
}

/**
 * Flat estimate of the CARRY parts a candidate source's own income x round-trip would need, independent
 * of Logistics' pooled/capped wantedTransport() — a self-contained approximation so selection doesn't
 * have to re-derive the whole fleet's sizing to price one more source.
 */
export function remoteTransportCarryParts(reserved: boolean, distance: number): number {
  const income = grossHarvest(reserved);
  const roundTrip = 2 * distance;
  const neededCarryEnergy = income * roundTrip * config.carryMargin;
  return Math.ceil(neededCarryEnergy / config.energyPerCarry);
}

/** Total body-part cost (miner + its transport share) a candidate source would add to the spawn load. */
export function remoteSourceLoadParts(energyCapacity: number, reserved: boolean, distance: number): number {
  const miner = remoteMinerBody(energyCapacity, reserved);
  return miner.length + remoteTransportCarryParts(reserved, distance);
}
