import { describe, expect, it } from "vitest";
import { summarizeMarketHistory, manufacturingCost } from "../../../src/empire/market";
import type { MarketMemory } from "../../../src/memory/schema";

function entry(overrides: Partial<PriceHistory>): PriceHistory {
  return {
    resourceType: RESOURCE_ENERGY,
    date: "2026-08-01",
    transactions: 1,
    volume: 100,
    avgPrice: 1,
    stddevPrice: 0.1,
    ...overrides
  };
}

describe("summarizeMarketHistory", () => {
  it("keeps the latest day's price per resource", () => {
    const history = [
      entry({ resourceType: RESOURCE_ENERGY, date: "2026-08-01", avgPrice: 1, stddevPrice: 0.1 }),
      entry({ resourceType: RESOURCE_ENERGY, date: "2026-08-03", avgPrice: 3, stddevPrice: 0.3 }),
      entry({ resourceType: RESOURCE_ENERGY, date: "2026-08-02", avgPrice: 2, stddevPrice: 0.2 })
    ];

    const result = summarizeMarketHistory(history, 1000);

    expect(result.tick).toBe(1000);
    expect(result.prices[RESOURCE_ENERGY]).toEqual({ date: "2026-08-03", avgPrice: 3, stddevPrice: 0.3 });
  });

  it("falls back to the latest valid day when the most recent day has null price data", () => {
    const history = [
      entry({ resourceType: RESOURCE_ENERGY, date: "2026-08-01", avgPrice: 1, stddevPrice: 0.1 }),
      entry({
        resourceType: RESOURCE_ENERGY,
        date: "2026-08-02",
        avgPrice: null as unknown as number,
        stddevPrice: null as unknown as number
      })
    ];

    const result = summarizeMarketHistory(history, 1000);

    expect(result.prices[RESOURCE_ENERGY]).toEqual({ date: "2026-08-01", avgPrice: 1, stddevPrice: 0.1 });
  });

  it("keeps multiple resources independently", () => {
    const history = [
      entry({ resourceType: RESOURCE_ENERGY, date: "2026-08-01", avgPrice: 1, stddevPrice: 0.1 }),
      entry({ resourceType: RESOURCE_OXYGEN, date: "2026-08-01", avgPrice: 5, stddevPrice: 0.5 })
    ];

    const result = summarizeMarketHistory(history, 1000);

    expect(result.prices[RESOURCE_ENERGY]).toEqual({ date: "2026-08-01", avgPrice: 1, stddevPrice: 0.1 });
    expect(result.prices[RESOURCE_OXYGEN]).toEqual({ date: "2026-08-01", avgPrice: 5, stddevPrice: 0.5 });
  });

  it("returns an empty prices object when every day is invalid", () => {
    const history = [
      entry({ resourceType: RESOURCE_ENERGY, avgPrice: undefined as unknown as number, stddevPrice: undefined as unknown as number })
    ];

    const result = summarizeMarketHistory(history, 1000);

    expect(result.prices).toEqual({});
  });
});

describe("manufacturingCost", () => {
  function prices(entries: Record<string, number>): MarketMemory["prices"] {
    const out: MarketMemory["prices"] = {};
    for (const [resource, avgPrice] of Object.entries(entries)) {
      out[resource as keyof MarketMemory["prices"]] = { date: "2026-08-01", avgPrice, stddevPrice: 0 };
    }
    return out;
  }

  it("prices a base resource straight from the market", () => {
    const result = manufacturingCost("O", prices({ O: 4 }));
    expect(result).toMatchObject({ resource: "O", cost: 4, method: "market" });
  });

  it("returns unpriced when a base resource has no market data and no recipe", () => {
    const result = manufacturingCost("O", prices({}));
    expect(result).toMatchObject({ resource: "O", cost: Infinity, method: "unpriced" });
  });

  it("picks the reaction recipe when it's cheaper than the market price", () => {
    // OH = H + O; recipe cost 1+1=2 vs market 10 -> recipe wins.
    const result = manufacturingCost("OH", prices({ H: 1, O: 1, OH: 10 }));
    expect(result.method).toBe("reaction");
    expect(result.cost).toBeCloseTo(2);
    // REACTION_TIME.OH=20 is the cooldown for one runReaction() batch of LAB_REACTION_AMOUNT=5 units,
    // so per-unit time is 20/5=4, not the raw 20.
    expect(result.time).toBe(4);
    expect(result.components?.map(c => c.resource).sort()).toEqual(["H", "O"]);
  });

  it("picks the market price when it's cheaper than reacting", () => {
    // OH = H + O; recipe cost 5+5=10 vs market 3 -> market wins.
    const result = manufacturingCost("OH", prices({ H: 5, O: 5, OH: 3 }));
    expect(result.method).toBe("market");
    expect(result.cost).toBe(3);
  });

  it("recurses through multi-level reactions (XUH2O = X + (UH2O = UH + OH = (U+H) + (O+H)))", () => {
    const result = manufacturingCost(
      "XUH2O",
      prices({ U: 1, H: 1, O: 1, X: 1 }) // force every leaf to be priced only via market, no shortcuts listed
    );
    // U+H=UH(2), H+O=OH(2), UH+OH=UH2O(4), X+UH2O=XUH2O(1+4=5)
    expect(result.cost).toBeCloseTo(5);
    expect(result.method).toBe("reaction");
  });

  it("prices a commodity from its components divided by output amount", () => {
    // utrium_bar: 500 U + 200 energy -> 100 bar, cooldown 20 (real @screeps/common recipe)
    const result = manufacturingCost("utrium_bar", prices({ U: 0.1, energy: 0.01 }));
    expect(result.method).toBe("commodity");
    // (500*0.1 + 200*0.01) / 100 = (50 + 2) / 100 = 0.52
    expect(result.cost).toBeCloseTo(0.52);
    expect(result.time).toBeCloseTo(0.2); // 20 cooldown / 100 output
  });

  it("prefers a listed commodity market price over its recipe when cheaper", () => {
    const result = manufacturingCost("utrium_bar", prices({ U: 0.1, energy: 0.01, utrium_bar: 0.2 }));
    expect(result.method).toBe("market");
    expect(result.cost).toBe(0.2);
  });

  it("ignores a raw mineral's decompress recipe by default, even with includeDecompress omitted", () => {
    // U's only COMMODITIES entry decompresses utrium_bar back into U — a factory recipe, not something
    // a colony without a factory can do. Default behavior treats U as market-only/mined.
    const result = manufacturingCost("U", prices({ utrium_bar: 1, energy: 0.01 }));
    expect(result.method).toBe("unpriced");
    expect(result.cost).toBe(Infinity);
  });

  it("uses the decompress recipe only when includeDecompress is true", () => {
    const withoutFlag = manufacturingCost("U", prices({ U: 5, utrium_bar: 1, energy: 0.01 }));
    expect(withoutFlag).toMatchObject({ method: "market", cost: 5 });

    const withFlag = manufacturingCost("U", prices({ U: 5, utrium_bar: 1, energy: 0.01 }), true);
    expect(withFlag.method).toBe("commodity");
    // U: components utrium_bar x100, energy x200, amount 500 -> (100*1 + 200*0.01)/500 = 100.2/500 = 0.2004
    // cheaper than market (5), so recipe wins once includeDecompress unlocks it.
    expect(withFlag.cost).toBeCloseTo(0.2004);
  });

  it("breaks the raw-mineral <-> bar decompression cycle via market price on the bar, when enabled", () => {
    // U's decompress recipe needs utrium_bar; utrium_bar's compress recipe needs U. With no market
    // price for U itself, pricing U (includeDecompress=true) must fall through to utrium_bar's market
    // price to break the cycle, not loop forever.
    const result = manufacturingCost("U", prices({ utrium_bar: 1, energy: 0.01 }), true);
    expect(Number.isFinite(result.cost)).toBe(true);
    expect(result.method).toBe("commodity");
    expect(result.cost).toBeCloseTo(0.2004);
  });
});
