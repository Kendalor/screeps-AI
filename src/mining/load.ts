// How many spawn "parts" (see colony/metrics.ts's load formula) one more remote source would cost —
// the miner it needs plus its share of the transport fleet's CARRY parts. Shared by pickRemotes (so
// selection can't over-commit the spawn). The transport share is priced through logistics/fleet.ts's
// wantedTransportParts — the exact function Logistics itself calls to size the real fleet — instead of
// a parallel approximation, so a candidate's estimated cost here can't drift from what Logistics ends
// up actually spawning once the source is selected.

import { orderBody } from "../spawn/body";
import type { BodyContext } from "../behaviors/types";
import { roleDef } from "../behaviors/roles";
import { wantedTransportParts, type IncomeConfig } from "../logistics/fleet";
import { grossHarvest } from "./remoteEconomics";

// Mirrors operations/logistics.ts's own config exactly — sourceRegenPerTick/roomIncomeCap/
// defaultHaulDistance/maxTransport don't affect a single candidate's marginal price (there's no local
// bucket or cap interaction at this stage), but wantedTransportParts' signature takes the whole
// IncomeConfig, so they're carried through as the same values Logistics uses rather than left undefined.
const config: IncomeConfig = {
  sourceRegenPerTick: 10,
  roomIncomeCap: 20,
  defaultHaulDistance: 10,
  energyPerCarry: 50,
  carryMargin: 1.2,
  maxTransport: 12
};

/** The miner body a candidate source would spawn, sized exactly as Mining's own remote request would. */
export function remoteMinerBody(energyCapacity: number, reserved: boolean): BodyPartConstant[] {
  const ctx: BodyContext = { hasContainer: false, hasLink: false, remote: true, reserved };
  return orderBody(roleDef("miner")?.body(energyCapacity, ctx) ?? []);
}

/**
 * The CARRY-fleet parts a candidate source's own income x round-trip would need, priced through the
 * same wantedTransportParts formula Logistics uses for the real fleet (headcount rounded to whole
 * hauler bodies, capped at maxTransport) — not a flat CARRY-count estimate that could size differently
 * from what actually gets spawned.
 */
export function remoteTransportCarryParts(energyCapacity: number, reserved: boolean, distance: number): number {
  const income = grossHarvest(reserved);
  return wantedTransportParts(income, distance, energyCapacity, config);
}

/** Total body-part cost (miner + its transport share) a candidate source would add to the spawn load. */
export function remoteSourceLoadParts(energyCapacity: number, reserved: boolean, distance: number): number {
  const miner = remoteMinerBody(energyCapacity, reserved);
  return miner.length + remoteTransportCarryParts(energyCapacity, reserved, distance);
}
