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
    // Already carrying load (just spawned, or resuming): skip straight to the consumer match using
    // that load — no wasted trip back through a provider it doesn't need.
    if (creep.storeEnergy > 0) {
      const consumer = sortedConsumers.find(
        c => c.resource === RESOURCE_ENERGY && (consumerRemaining.get(refKey(c.ref)) ?? 0) > 0
      );
      if (!consumer) continue;
      const consumerKey = refKey(consumer.ref);
      const amount = Math.min(creep.storeEnergy, consumerRemaining.get(consumerKey) ?? 0);
      if (amount <= 0) continue;
      consumerRemaining.set(consumerKey, (consumerRemaining.get(consumerKey) ?? 0) - amount);
      out[creep.id] = { kind: "deliver", to: consumer.ref, resource: RESOURCE_ENERGY, amount };
      continue;
    }

    const capacity = creep.storeCapacity;
    if (capacity <= 0) continue;

    const consumer = sortedConsumers.find(c => (consumerRemaining.get(refKey(c.ref)) ?? 0) > 0);
    if (!consumer) continue;

    const provider = pickLargestProvider(providers, providerRemaining, consumer.resource);
    if (!provider) continue;

    const consumerKey = refKey(consumer.ref);
    const providerKey = refKey(provider.ref);
    const amount = Math.min(capacity, providerRemaining.get(providerKey) ?? 0, consumerRemaining.get(consumerKey) ?? 0);
    if (amount <= 0) continue;

    consumerRemaining.set(consumerKey, (consumerRemaining.get(consumerKey) ?? 0) - amount);
    providerRemaining.set(providerKey, (providerRemaining.get(providerKey) ?? 0) - amount);

    // Pair the deliver leg into `next` so the creep flows pickup->deliver with no idle re-plan tick
    // between. The consumer is reserved once here (consumerRemaining, above); the embedded deliver is
    // NOT re-folded into `reserved` next tick — foldReserved counts `current` only for exactly this
    // reason, since `next` always names the same energy `current` already reserved via its `to`.
    out[creep.id] = {
      kind: "pickup",
      from: provider.ref,
      to: consumer.ref,
      resource: consumer.resource,
      amount,
      next: { kind: "deliver", to: consumer.ref, resource: consumer.resource, amount }
    };
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
