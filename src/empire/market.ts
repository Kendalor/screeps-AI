// Distills Game.market.getHistory()'s daily entries into a per-resource latest-valid-average snapshot.
// Read-only, so this bypasses the Intent/execute.ts actuator — see execute.ts's observeRoom() for the
// same "live-game read written near where it's read" shape. Trading (createOrder/deal) is a separate,
// unbuilt follow-up.

import type { MarketStats } from "../memory/schema";

// Tier-3 SYSTEMS interval (see kernel/tick.ts); exported so the console's scanMarket() and the SYSTEMS
// entry can't drift apart from this number.
export const MARKET_SCAN_INTERVAL = 20000;

export function summarizeMarketHistory(history: readonly PriceHistory[], tick: number): Pick<MarketStats, "tick" | "prices"> {
  const prices: MarketStats["prices"] = {};
  // Tracks the latest valid `date` seen per resource TRANSIENTLY, to pick the latest of several days —
  // getHistory() is documented oldest-first, so this could also just take the last valid element; either
  // is fine internally. Only the write to Memory (the returned `prices`) drops `date`, since MarketStats'
  // container-level `tick` already answers every freshness question downstream code needs.
  const latestDate = new Map<string, string>();
  for (const entry of history) {
    // Skip days with no valid price data (e.g. no trades that day) — don't let a null/undefined
    // avgPrice overwrite a still-valid earlier day, and don't record a null price at all.
    if (entry.avgPrice == null || entry.stddevPrice == null) continue;
    const seenDate = latestDate.get(entry.resourceType);
    // getHistory() returns each resource's days oldest-first; keep whichever valid day is latest.
    if (!seenDate || entry.date > seenDate) {
      latestDate.set(entry.resourceType, entry.date);
      prices[entry.resourceType] = { avgPrice: entry.avgPrice, stddevPrice: entry.stddevPrice };
    }
  }
  return { tick, prices };
}

export function scanMarketNow(): Pick<MarketStats, "tick" | "prices"> {
  return summarizeMarketHistory(Game.market.getHistory(), Game.time);
}

// A resource's per-unit build cost: either bought outright at market price, or reacted/manufactured
// from its own components (each priced the same way, recursively). "cost" always picks the cheaper of
// the two so the number reflects what a rational colony would actually pay, not the raw recipe price.
export interface ManufacturingCost {
  resource: string;
  cost: number; // credits per unit, cheaper of market price and recipe cost
  method: "market" | "reaction" | "commodity" | "unpriced";
  marketPrice?: number; // Memory.market's cached avgPrice, if any
  recipeCost?: number; // sum of component costs (reaction: 1:1; commodity: per COMMODITIES.components ratio, divided by output amount)
  time?: number; // ticks per unit: REACTION_TIME / LAB_REACTION_AMOUNT (reactions always batch 5 at a time), or COMMODITIES cooldown / amount
  components?: ManufacturingCost[];
}

// Every REACTIONS entry is duplicated (A+B and B+A both point at the product); build the reverse map
// once so a product resolves to its one recipe instead of picking whichever key iteration hits first.
function buildReactionInputs(): Map<string, [string, string]> {
  const inputs = new Map<string, [string, string]>();
  for (const a of Object.keys(REACTIONS)) {
    for (const b of Object.keys(REACTIONS[a])) {
      const product = REACTIONS[a][b];
      if (!inputs.has(product)) inputs.set(product, [a, b]);
    }
  }
  return inputs;
}

// Lazy + memoized: built from the REACTIONS global on first use, not at module load, so importing
// this module doesn't require the Screeps runtime constants to exist yet (e.g. under test).
let reactionInputsCache: Map<string, [string, string]> | undefined;
function reactionInputsFor(resource: string): [string, string] | undefined {
  reactionInputsCache ??= buildReactionInputs();
  return reactionInputsCache.get(resource);
}

// COMMODITIES has two kinds of entry: a normal "compress" recipe (bar/commodity <- its raw inputs) and,
// for every raw mineral plus energy, a reverse "decompress" recipe (raw <- its own compressed form, e.g.
// O <- oxidant, energy <- battery). Structurally these are the only entries whose *output* is a base
// mineral/energy symbol — used to gate them behind includeDecompress rather than hardcoding the list.
const BASE_RESOURCES = new Set(["H", "O", "U", "L", "K", "Z", "G", "X", "energy"]);

export function manufacturingCost(
  resource: string,
  prices: MarketStats["prices"],
  includeDecompress = false,
  seen: Set<string> = new Set()
): ManufacturingCost {
  const marketPrice = (prices as Record<string, { avgPrice: number } | undefined>)[resource]?.avgPrice;

  // Guard against cycles (there are none in REACTIONS/COMMODITIES today, but a bad edit shouldn't
  // recurse forever) — a resource already on the current path can only be priced from the market.
  if (seen.has(resource)) {
    return marketPrice != null
      ? { resource, cost: marketPrice, method: "market", marketPrice }
      : { resource, cost: Infinity, method: "unpriced" };
  }
  const nextSeen = new Set(seen).add(resource);

  const reactionInputs = reactionInputsFor(resource);
  const commodityRaw = (COMMODITIES as Record<string, CommodityEntry | undefined>)[resource];
  // A base mineral/energy's only COMMODITIES entry is its decompress recipe — skip it unless asked for,
  // so by default manufacturingCost treats raw minerals as market-only (mined, not manufactured).
  const commodity = commodityRaw && (includeDecompress || !BASE_RESOURCES.has(resource)) ? commodityRaw : undefined;

  let recipeCost: number | undefined;
  let time: number | undefined;
  let components: ManufacturingCost[] | undefined;
  let method: ManufacturingCost["method"] = "market";

  if (reactionInputs) {
    // Cost per unit is unaffected by batch size: runReaction() consumes LAB_REACTION_AMOUNT (5) of each
    // input to produce LAB_REACTION_AMOUNT of the product, a 1:1 ratio regardless of batch size. Time
    // is not: REACTION_TIME[product] is the cooldown for one runReaction() *call*, which always yields
    // a full batch of 5 — so time per unit is REACTION_TIME divided by the batch size, not the raw value.
    components = reactionInputs.map(input => manufacturingCost(input, prices, includeDecompress, nextSeen));
    recipeCost = components.reduce((sum, c) => sum + c.cost, 0);
    time = ((REACTION_TIME as Record<string, number>)[resource] ?? 0) / LAB_REACTION_AMOUNT;
    method = "reaction";
  } else if (commodity) {
    components = Object.entries(commodity.components).map(([res, qty]) =>
      scaleCost(manufacturingCost(res, prices, includeDecompress, nextSeen), qty as number)
    );
    const inputCost = components.reduce((sum, c) => sum + c.cost, 0);
    recipeCost = inputCost / commodity.amount;
    time = commodity.cooldown / commodity.amount;
    method = "commodity";
  }

  if (recipeCost != null && (marketPrice == null || recipeCost <= marketPrice)) {
    // Infinity means every path (market and recipe) bottomed out unpriced — usually a cycle back to
    // this same resource (e.g. O -> oxidant -> O) with nothing outside it ever getting a market price.
    // Reporting that as "recipe"/"commodity" would suggest a usable number; it isn't one.
    const finalMethod = Number.isFinite(recipeCost) ? method : "unpriced";
    return { resource, cost: recipeCost, method: finalMethod, marketPrice, recipeCost, time, components };
  }
  if (marketPrice != null) {
    return { resource, cost: marketPrice, method: "market", marketPrice, recipeCost, time, components };
  }
  if (recipeCost != null) {
    // No market price at all (e.g. unlisted commodity) — recipe cost is all we have.
    const finalMethod = Number.isFinite(recipeCost) ? method : "unpriced";
    return { resource, cost: recipeCost, method: finalMethod, recipeCost, time, components };
  }
  return { resource, cost: Infinity, method: "unpriced" };
}

function scaleCost(cost: ManufacturingCost, qty: number): ManufacturingCost {
  return { ...cost, cost: cost.cost * qty };
}

export function formatManufacturingCost(cost: ManufacturingCost, depth = 0): string {
  const indent = "  ".repeat(depth);
  const price = Number.isFinite(cost.cost) ? cost.cost.toFixed(3) : "unpriced";
  const marketPart = cost.marketPrice != null ? ` market=${cost.marketPrice.toFixed(3)}` : " market=-";
  const recipePart = cost.recipeCost != null ? ` recipe=${cost.recipeCost.toFixed(3)}` : "";
  const timePart = cost.time != null ? ` time=${cost.time.toFixed(2)}t/u` : "";
  let line = `${indent}${cost.resource}: ${price} cr/u [${cost.method}]${marketPart}${recipePart}${timePart}`;
  if (cost.components) {
    for (const c of cost.components) line += `\n${formatManufacturingCost(c, depth + 1)}`;
  }
  return line;
}
