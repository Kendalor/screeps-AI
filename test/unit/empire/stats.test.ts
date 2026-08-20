// Unit-proves collectEmpireStats (empire/stats.ts) as a pure aggregation over the same
// EmpireStock/EmpireRequest shapes logistics.test.ts already fixtures — see that file's header for why
// this stays a plain-object test rather than a mockup-server one.

import { describe, expect, it } from "vitest";
import { collectEmpireStats, type WalletStock } from "../../../src/empire/stats";
import type { EmpireStock } from "../../../src/empire/logistics";

function stock(overrides: Partial<Record<ResourceConstant, number>> = {}): EmpireStock {
  return {
    getUsedCapacity: (r: ResourceConstant) => overrides[r] ?? 0
  };
}

function colonyStock(colony: string, storage: EmpireStock | undefined, terminal: EmpireStock | undefined) {
  return { colony, storage, terminal };
}

const wallet: WalletStock = { credits: 0, pixels: 0, cpuUnlocks: 0, subscriptionTokens: 0 };

describe("collectEmpireStats", () => {
  it("passes wallet fields straight through", () => {
    const w: WalletStock = { credits: 12345, pixels: 7, cpuUnlocks: 2, subscriptionTokens: 1 };
    const result = collectEmpireStats([], {}, () => undefined, w);
    expect(result.credits).toBe(12345);
    expect(result.pixels).toBe(7);
    expect(result.cpuUnlocks).toBe(2);
    expect(result.subscriptionTokens).toBe(1);
  });

  it("sums stock for a resource across every colony", () => {
    const colonies = [
      colonyStock("W1N1", stock({ GO: 1000 }), stock({ GO: 200 })),
      colonyStock("W2N2", stock({ GO: 500 }), undefined)
    ];
    const result = collectEmpireStats(colonies, { GO: 3000 }, () => undefined, wallet);
    expect(result.resources?.GO).toBe(1000 + 200 + 500);
  });

  it("sums the signed per-colony deficit to one empire-total number", () => {
    // W1N1 is 2000 below target (deficit +2000), W2N2 is 500 above target (surplus -500) — empire-total
    // net deficit is the sum of both signed amounts, same sign convention as EmpireRequest.amount.
    const colonies = [colonyStock("W1N1", stock({ GO: 1000 }), undefined), colonyStock("W2N2", stock({ GO: 3500 }), undefined)];
    const result = collectEmpireStats(colonies, { GO: 3000 }, () => undefined, wallet);
    expect(result.deficits?.GO).toBe(2000 + -500);
  });

  it("a colony exactly at target contributes stock but no deficit entry", () => {
    const colonies = [colonyStock("W1N1", stock({ GO: 3000 }), undefined)];
    const result = collectEmpireStats(colonies, { GO: 3000 }, () => undefined, wallet);
    expect(result.resources?.GO).toBe(3000);
    expect(result.deficits?.GO).toBeUndefined();
  });

  it("applies role multipliers per colony before summing the deficit", () => {
    const colonies = [colonyStock("W1N1", stock({ GO: 0 }), undefined)];
    const frontline = collectEmpireStats(colonies, { GO: 1000 }, () => "frontline", wallet);
    const backline = collectEmpireStats(colonies, { GO: 1000 }, () => "backline", wallet);
    expect(frontline.deficits?.GO).toBeGreaterThan(backline.deficits?.GO ?? 0);
  });

  it("emits a zero-stock entry for a target resource nobody holds", () => {
    const result = collectEmpireStats([colonyStock("W1N1", stock(), undefined)], { GO: 3000 }, () => undefined, wallet);
    expect(result.resources?.GO).toBe(0);
    expect(result.deficits?.GO).toBe(3000);
  });
});
