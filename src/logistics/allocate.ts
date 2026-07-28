// The allocator: greedy, priority-first matching of idle creeps to consumers, backed by providers,
// with no double-booking. Matches the codebase's existing style (targets.ts's resolveTarget is also
// greedy, not a solver) rather than introducing a new optimizer.
//
// Provider/Consumer carry no position (SnapCreep has none either — a snapshot fact, not an oversight
// here), so "nearest provider" isn't computable at this layer. Picks the largest available provider
// per pickup instead, mirroring hauler.ts's own `prefer: "largest"` default for its gather step.
// Which of {nearest, largest-capacity-first} allocation order performs better is the plan's open
// question 1 — worth a benchmark once there's a real workload, not resolved by guessing here.

import type { DeepReadonly, SnapCreep } from "../snapshot/types";
import type { Consumer, Provider } from "./graph";
import type { LogisticsTask, NodeRef } from "./types";

export interface ReservedAmounts {
  providers: Partial<Record<string, number>>; // keyed by NodeRef identity string, amount already claimed
  consumers: Partial<Record<string, number>>;
}

export function emptyReserved(): ReservedAmounts {
  return { providers: {}, consumers: {} };
}

// A NodeRef has no single natural id field ("spawnSystem" has none at all) — key reservations by a
// stable string so pickup/deliver targets from different kinds never collide in the same map. Accepts
// the DeepReadonly variant too, since planLogistics reads NodeRefs back out of a snapshot creep's
// (deeply readonly) memory when folding in-flight tasks into `reserved`.
export function refKey(ref: NodeRef | DeepReadonly<NodeRef>): string {
  switch (ref.kind) {
    case "spawnSystem":
      return "spawnSystem";
    case "structure":
    case "dropped":
    case "tombstone":
    case "creep":
      return `${ref.kind}:${ref.id}`;
  }
}

export function allocate(
  providers: readonly Provider[],
  consumers: readonly Consumer[],
  idleCreeps: readonly SnapCreep[],
  reserved: ReservedAmounts
): Record<Id<Creep>, LogisticsTask> {
  const out: Record<Id<Creep>, LogisticsTask> = {};

  const consumerRemaining = new Map<string, number>();
  const sortedConsumers = [...consumers].sort((a, b) => b.priority - a.priority || b.wanted - a.wanted);
  for (const c of sortedConsumers) {
    consumerRemaining.set(refKey(c.ref), c.wanted - (reserved.consumers[refKey(c.ref)] ?? 0));
  }

  const providerRemaining = new Map<string, number>();
  for (const p of providers) {
    providerRemaining.set(refKey(p.ref), p.available - (reserved.providers[refKey(p.ref)] ?? 0));
  }

  // Loaded creeps first: a creep already carrying energy should win a deliver before an empty creep is
  // sent on a round trip for the same consumer — the pre-loaded one is ready this tick, the empty one
  // isn't. (A creep pre-loaded speculatively from a drop, below, is exactly the case this serves.)
  const byLoadedFirst = [...idleCreeps].sort((a, b) => b.storeEnergy - a.storeEnergy);

  for (const creep of byLoadedFirst) {
    // Already carrying load (just spawned, or resuming): skip straight to delivering that load — no
    // wasted trip back through a provider it doesn't need. Spread it across as many consumers as it
    // takes to empty the creep (e.g. a 200-energy creep filling four 50-cap extensions in one trip).
    if (creep.storeEnergy > 0) {
      const delivers = buildDeliverChain(sortedConsumers, consumerRemaining, RESOURCE_ENERGY, creep.storeEnergy);
      const chain = linkDelivers(delivers);
      if (chain) out[creep.id] = chain;
      continue;
    }

    const capacity = creep.storeCapacity;
    if (capacity <= 0) continue;

    // Load up to the creep's full capacity, bounded by the total the currently-reservable consumers
    // want — no point carrying energy nothing has room for. Filling to capacity (not one consumer's
    // want) is what lets a single full creep then fan out across many extensions below.
    const wantOpen = openConsumerDemand(sortedConsumers, consumerRemaining, RESOURCE_ENERGY);
    const fillTarget = Math.min(capacity, wantOpen);
    if (fillTarget <= 0) continue;

    const pickups = buildPickupChain(providers, providerRemaining, RESOURCE_ENERGY, fillTarget);
    if (pickups.length === 0) continue;
    const loaded = pickups.reduce((sum, p) => sum + p.amount, 0);

    // Spread the load across consumers (highest priority first) — a chain of delivers, one per sink,
    // each reserved so no other creep is sent to a sink this trip will fill. Providers were reserved in
    // buildPickupChain; consumers are reserved in buildDeliverChain. foldReserved re-derives both from
    // the stored chain next tick, so a mid-trip creep never double-books either side.
    const delivers = buildDeliverChain(sortedConsumers, consumerRemaining, RESOURCE_ENERGY, loaded);

    // Head pickup carries the first deliver's consumer as its `to` so foldReserved can read *a*
    // destination off `current`; the full per-consumer accounting lives in the deliver legs it walks.
    const deliverChain = linkDelivers(delivers);
    let chain: LogisticsTask | undefined = deliverChain;
    const headTo = delivers[0]?.ref;
    for (let i = pickups.length - 1; i >= 0; i--) {
      chain = { kind: "pickup", from: pickups[i].ref, to: headTo, resource: RESOURCE_ENERGY, amount: pickups[i].amount, next: chain };
    }
    if (chain) out[creep.id] = chain;
  }

  // Speculative pass: an empty creep with no consumer-driven job still tops itself off from any DECAYING
  // source (dropped piles, tombstones), so it's pre-loaded and ready the instant a consumer appears —
  // and the energy isn't lost to decay meanwhile. Decaying-only on purpose: container energy doesn't
  // rot, so pulling it before a consumer wants it just moves the idle wait to the deliver side and
  // fights miners for the container. These pickups carry NO `to`/`next` — the consumer is unknown yet;
  // the loaded creep gets a deliver on a later tick, ahead of empty creeps (byLoadedFirst, above).
  for (const creep of byLoadedFirst) {
    if (out[creep.id]) continue; // already assigned by the consumer-driven pass
    const free = creep.storeCapacity - creep.storeEnergy;
    if (free <= 0) continue;

    const provider = pickLargestDecayingProvider(providers, providerRemaining);
    if (!provider) continue;

    const providerKey = refKey(provider.ref);
    const amount = Math.min(free, providerRemaining.get(providerKey) ?? 0);
    if (amount <= 0) continue;

    providerRemaining.set(providerKey, (providerRemaining.get(providerKey) ?? 0) - amount);
    out[creep.id] = { kind: "pickup", from: provider.ref, resource: provider.resource, amount };
  }

  return out;
}

// Greedily draw `fillTarget` from the largest available providers in turn, decrementing each in
// `remaining` as it's claimed so the same energy is never handed to two legs. Returns one entry per
// provider tapped ({ref, amount}); stops as soon as the target is met or providers run dry. Largest-
// first mirrors the single-pickup pass's pickLargestProvider (and hauler.ts's `prefer: "largest"`),
// keeping trips short by preferring fuller sources first.
function buildPickupChain(
  providers: readonly Provider[],
  remaining: Map<string, number>,
  resource: ResourceConstant,
  fillTarget: number
): { ref: NodeRef; amount: number }[] {
  const out: { ref: NodeRef; amount: number }[] = [];
  let need = fillTarget;
  while (need > 0) {
    const provider = pickLargestProvider(providers, remaining, resource);
    if (!provider) break;
    const key = refKey(provider.ref);
    const take = Math.min(need, remaining.get(key) ?? 0);
    if (take <= 0) break;
    remaining.set(key, (remaining.get(key) ?? 0) - take);
    out.push({ ref: provider.ref, amount: take });
    need -= take;
  }
  return out;
}

// Total energy the currently-reservable consumers still want, in priority order — the ceiling on how
// much a creep should load, since carrying more than any consumer has room for just idles on the creep.
function openConsumerDemand(consumers: readonly Consumer[], remaining: Map<string, number>, resource: ResourceConstant): number {
  let sum = 0;
  for (const c of consumers) {
    if (c.resource !== resource) continue;
    sum += Math.max(0, remaining.get(refKey(c.ref)) ?? 0);
  }
  return sum;
}

// Spread `available` energy across consumers (already priority-sorted) until it's used up or demand
// runs out, decrementing each consumer's remaining so no other creep is sent to a sink this trip fills.
// Returns one entry per consumer tapped ({ref, amount}) — the caller links them into a deliver chain.
function buildDeliverChain(
  consumers: readonly Consumer[],
  remaining: Map<string, number>,
  resource: ResourceConstant,
  available: number
): { ref: NodeRef; amount: number }[] {
  const out: { ref: NodeRef; amount: number }[] = [];
  let left = available;
  for (const c of consumers) {
    if (left <= 0) break;
    if (c.resource !== resource) continue;
    const key = refKey(c.ref);
    const want = remaining.get(key) ?? 0;
    if (want <= 0) continue;
    const give = Math.min(left, want);
    remaining.set(key, want - give);
    out.push({ ref: c.ref, amount: give });
    left -= give;
  }
  return out;
}

// Link deliver legs into a `next`-chained task (deliver1 -> deliver2 -> ...); undefined if empty.
function linkDelivers(delivers: readonly { ref: NodeRef; amount: number }[]): LogisticsTask | undefined {
  let chain: LogisticsTask | undefined;
  for (let i = delivers.length - 1; i >= 0; i--) {
    chain = { kind: "deliver", to: delivers[i].ref, resource: RESOURCE_ENERGY, amount: delivers[i].amount, next: chain };
  }
  return chain;
}

function isDecaying(ref: NodeRef): boolean {
  return ref.kind === "dropped" || ref.kind === "tombstone";
}

function pickLargestDecayingProvider(providers: readonly Provider[], remaining: Map<string, number>): Provider | undefined {
  let best: Provider | undefined;
  let bestAmount = 0;
  for (const p of providers) {
    if (p.resource !== RESOURCE_ENERGY || !isDecaying(p.ref)) continue;
    const left = remaining.get(refKey(p.ref)) ?? 0;
    if (left > bestAmount) {
      best = p;
      bestAmount = left;
    }
  }
  return best;
}

function pickLargestProvider(
  providers: readonly Provider[],
  remaining: Map<string, number>,
  resource: ResourceConstant
): Provider | undefined {
  let best: Provider | undefined;
  let bestAmount = 0;
  for (const p of providers) {
    if (p.resource !== resource) continue;
    const left = remaining.get(refKey(p.ref)) ?? 0;
    if (left > bestAmount) {
      best = p;
      bestAmount = left;
    }
  }
  return best;
}
