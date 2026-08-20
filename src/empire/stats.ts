// Empire-wide Grafana gauges (wallet + resource stock/deficit) — see memory/schema.ts's EmpireStats for
// the persisted shape. Pure aggregation over the same ColonyEmpireStock/EmpireRequest shapes
// empire/logistics.ts already computes with, so this never re-derives a colony's effective target itself;
// it just sums logistics.ts's own per-colony numbers to empire scope. The Game-coupled read (Game.market
// .credits, Game.resources[...]) lives in the tier-3 SYSTEMS call site (kernel/tick.ts), same split as
// runEmpireLogisticsPass/computeEmpireRequests.

import type { ColonyRole } from "../memory/schema";
import type { EmpireStats } from "../memory/schema";
import { computeEmpireRequests, type ColonyEmpireStock } from "./logistics";

export interface WalletStock {
  credits: number;
  pixels: number;
  cpuUnlocks: number;
  subscriptionTokens: number;
}

/**
 * Sums computeEmpireRequests' per-colony EmpireRequest amounts to one empire-total deficit per resource
 * (positive = empire-wide short, negative = empire-wide surplus), and separately sums live stock
 * (storage+terminal across every colony) per resource — both keyed by the same `targets` resource set
 * logistics.ts already matches against.
 */
export function collectEmpireStats(
  colonies: readonly ColonyEmpireStock[],
  targets: Partial<Record<ResourceConstant, number>>,
  roleOf: (colony: string) => ColonyRole | undefined,
  wallet: WalletStock
): EmpireStats {
  const requests = computeEmpireRequests(colonies, targets, roleOf);

  const deficits: Record<string, number> = {};
  for (const r of requests) deficits[r.resource] = (deficits[r.resource] ?? 0) + r.amount;

  const resources: Record<string, number> = {};
  for (const resource of Object.keys(targets) as ResourceConstant[]) {
    let stock = 0;
    for (const c of colonies) stock += (c.storage?.getUsedCapacity(resource) ?? 0) + (c.terminal?.getUsedCapacity(resource) ?? 0);
    resources[resource] = stock;
  }

  return {
    credits: wallet.credits,
    pixels: wallet.pixels,
    cpuUnlocks: wallet.cpuUnlocks,
    subscriptionTokens: wallet.subscriptionTokens,
    resources,
    deficits
  };
}
