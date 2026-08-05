// The allocator: greedy, priority-first matching of idle creeps to consumers, backed by providers,
// with no double-booking. Matches the codebase's existing style (targets.ts's resolveTarget is also
// greedy, not a solver) rather than introducing a new optimizer.
//
// Pickup selection resolves the plan's former open question 1 ({nearest, largest-capacity-first}):
// a creep's first choice is the NEAREST provider that alone has enough to fill its trip (see
// pickNearestFillingProvider) — a short trip to a source that covers the whole load beats a longer one
// to a bigger pile. Only when no single provider can fill the trip alone does it fall back to
// largest-available-first chaining (pickLargestProvider/pickLargestDecayingProvider), mirroring
// hauler.ts's own `prefer: "largest"` default, to combine as few providers as possible.

import type { XY } from "../lib/geometry";
import { pathDistance, RoadCostMatrix } from "../layouts/roads";
import type { DeepReadonly, SnapCreep } from "../snapshot/types";
import type { Consumer, Provider, StorageOverflow } from "./graph";
import type { LogisticsTask, NodeRef } from "./types";

// Withdraw/pickup/transfer all act at range 1 (see behaviors/actions.ts's actOnResolved default) — the
// same range a real trip needs, so the path-distance query below matches what the creep will actually walk.
const PICKUP_RANGE = 1;

// The farthest hop buildDeliverChain will take BETWEEN two consumers already in the same chain, once it
// has at least one stop. A dense bunker's extensions sit 0-1 tiles apart; a real cross-room-scale jump
// (5+ tiles) only happens once the nearby cluster the creep is standing in has been drained and the
// only "nearest remaining" consumer left is a scattered leftover clear across the room — visited only
// because every closer one already got claimed by the graph (full, or reserved). Chaining onto it
// anyway produces exactly the zig-zag confirmed live on W8N3: fill a local cluster, jump 5-7 tiles to an
// isolated extension, then jump right back the way it came for another isolated one on the far side of
// the first cluster. Stopping the chain at the cluster boundary instead leaves the far leftovers for a
// fresh plan next tick — cheap, since idle-replanning already happens every tick a creep goes idle — and
// lets whichever creep (this one or a sibling) is actually closest by then pick them up instead. Does
// NOT cap the first hop from the creep's own position: reaching the one open consumer in the room, no
// matter how far, is a legitimate single trip, not a zig-zag.
const MAX_CHAIN_HOP = 3;

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
    case "ruin":
    case "creep":
      return `${ref.kind}:${ref.id}`;
  }
}

export function allocate(
  providers: readonly Provider[],
  consumers: readonly Consumer[],
  idleCreeps: readonly SnapCreep[],
  reserved: ReservedAmounts,
  storageOverflow: StorageOverflow | null = null,
  // Terrain/structure-aware cost matrix for the home room, built once by the caller (see
  // logistics/index.ts) so every pickNearestFillingProvider call this tick reuses the same matrix
  // instead of rebuilding it per creep. Defaults to an all-open matrix (no walls/structures) so callers
  // that don't care about obstacles — most existing tests — get plain walkable-distance behavior.
  costMatrix: RoadCostMatrix = new RoadCostMatrix()
): Record<Id<Creep>, LogisticsTask> {
  const out: Record<Id<Creep>, LogisticsTask> = {};
  // Mutable across this whole call so two loaded creeps in the same tick don't both dump into storage
  // past its real free capacity — decremented as the fallback below claims it.
  let overflowFree = storageOverflow?.free ?? 0;

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
      // Still out in a remote room: don't pick (and reserve) a consumer yet — that would park a
      // spawn/extension reservation for the whole cross-room trip home. Head home first; a deliver
      // gets chosen fresh, against live demand, once a later tick finds it idle inside the home room.
      if (creep.room !== creep.home) {
        out[creep.id] = { kind: "travelHome", resource: RESOURCE_ENERGY, amount: creep.storeEnergy };
        continue;
      }
      const delivers = buildDeliverChain(sortedConsumers, consumerRemaining, RESOURCE_ENERGY, creep.storeEnergy, creep, costMatrix);
      const delivered = delivers.reduce((sum, d) => sum + d.amount, 0);
      const leftover = creep.storeEnergy - delivered;
      // No live consumer wanted (all of) what this creep carries: dump the rest into storage rather
      // than stranding it on the creep or, worse, letting the speculative pass below send it to fetch
      // even MORE energy on top of what it can't deliver. Never a pickup, so this can't reintroduce the
      // withdraw-then-redeposit loop storage's consumer-side gate (above) guards against.
      if (leftover > 0 && storageOverflow && overflowFree > 0 && !delivers.some(d => refKey(d.ref) === refKey(storageOverflow.ref))) {
        const dump = Math.min(leftover, overflowFree);
        overflowFree -= dump;
        delivers.push({ ref: storageOverflow.ref, amount: dump });
      }
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

    const pickups = buildPickupChain(providers, providerRemaining, RESOURCE_ENERGY, fillTarget, creep, costMatrix);
    if (pickups.length === 0) continue;
    const loaded = pickups.reduce((sum, p) => sum + p.amount, 0);

    // Any leg of this trip draws from a remote (cross-room) provider: queue the pickup(s) alone, with
    // no deliver chained on — see the byLoadedFirst travelHome branch above for why. consumerRemaining
    // is deliberately left untouched (nothing was reserved), so other creeps still see full demand.
    if (pickups.some(p => p.remote)) {
      let remoteChain: LogisticsTask | undefined;
      for (let i = pickups.length - 1; i >= 0; i--) {
        remoteChain = { kind: "pickup", from: pickups[i].ref, resource: RESOURCE_ENERGY, amount: pickups[i].amount, next: remoteChain };
      }
      if (remoteChain) out[creep.id] = remoteChain;
      continue;
    }

    // Spread the load across consumers (highest priority first) — a chain of delivers, one per sink,
    // each reserved so no other creep is sent to a sink this trip will fill. Providers were reserved in
    // buildPickupChain; consumers are reserved in buildDeliverChain. foldReserved re-derives both from
    // the stored chain next tick, so a mid-trip creep never double-books either side. Route starts from
    // the LAST pickup's position (where the creep will actually be once loaded), not its current spot —
    // falls back to the creep's own position when the last pickup has none (a remote source).
    const lastPickupPos = pickups[pickups.length - 1]?.pos ?? creep;
    const delivers = buildDeliverChain(sortedConsumers, consumerRemaining, RESOURCE_ENERGY, loaded, lastPickupPos, costMatrix);

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

    const provider =
      pickNearestFillingProvider(providers, providerRemaining, RESOURCE_ENERGY, creep, free, costMatrix, isDecaying) ??
      pickLargestDecayingProvider(providers, providerRemaining);
    if (!provider) continue;

    const providerKey = refKey(provider.ref);
    const amount = Math.min(free, providerRemaining.get(providerKey) ?? 0);
    if (amount <= 0) continue;

    providerRemaining.set(providerKey, (providerRemaining.get(providerKey) ?? 0) - amount);
    out[creep.id] = { kind: "pickup", from: provider.ref, resource: provider.resource, amount };
  }

  return out;
}

// Greedily draw `fillTarget` from providers in turn, decrementing each in `remaining` as it's claimed
// so the same energy is never handed to two legs. Returns one entry per provider tapped
// ({ref, amount}); stops as soon as the target is met or providers run dry. Each leg first tries the
// NEAREST provider (to `from`, the creep's own position) that alone still has enough left to cover the
// remaining need — a short trip that fully covers the load beats a longer one to a bigger pile. Only
// when nothing qualifies (need > every provider's remaining) does it fall back to largest-available-
// first (pickLargestProvider, mirroring hauler.ts's `prefer: "largest"`), which combines as few
// providers as possible to fill the remainder.
function buildPickupChain(
  providers: readonly Provider[],
  remaining: Map<string, number>,
  resource: ResourceConstant,
  fillTarget: number,
  from: XY,
  costMatrix: RoadCostMatrix
): { ref: NodeRef; amount: number; remote?: boolean; pos: XY | null }[] {
  const out: { ref: NodeRef; amount: number; remote?: boolean; pos: XY | null }[] = [];
  let need = fillTarget;
  while (need > 0) {
    const provider =
      pickNearestFillingProvider(providers, remaining, resource, from, need, costMatrix) ?? pickLargestProvider(providers, remaining, resource);
    if (!provider) break;
    const key = refKey(provider.ref);
    const take = Math.min(need, remaining.get(key) ?? 0);
    if (take <= 0) break;
    remaining.set(key, (remaining.get(key) ?? 0) - take);
    out.push({ ref: provider.ref, amount: take, remote: provider.remote, pos: provider.pos });
    need -= take;
  }
  return out;
}

// Among providers that alone still have at least `need` left, returns the nearest to `from` (the
// creep's own position) by real walkable-tile path distance, not Chebyshev/linear range — a wall
// between the creep and a "close" provider makes it lose to a farther-but-reachable one, same as a
// creep would actually experience. A home provider (`pos` set) is path-found against `costMatrix`; a
// remote provider (`pos: null`, `remote: true`) uses its cached anchor->source route length instead —
// its real position lives in a different room's coordinate space, not comparable to `from` by any
// single path search here, so the precomputed distance stands in for it. A provider with neither
// (`pos: null` and no `remoteDistance`) is skipped; it only ever gets tapped via the largest-first
// fallback. Ties (equal distance) keep the first-encountered candidate, matching the tie-break every
// other picker in this file uses.
function pickNearestFillingProvider(
  providers: readonly Provider[],
  remaining: Map<string, number>,
  resource: ResourceConstant,
  from: XY,
  need: number,
  costMatrix: RoadCostMatrix,
  filter?: (ref: NodeRef) => boolean
): Provider | undefined {
  let best: Provider | undefined;
  let bestDistance = Infinity;
  for (const p of providers) {
    if (p.resource !== resource) continue;
    if (filter && !filter(p.ref)) continue;
    const left = remaining.get(refKey(p.ref)) ?? 0;
    if (left < need) continue;
    const d = p.remote ? (p.remoteDistance ?? Infinity) : p.pos ? pathDistance(from, p.pos, PICKUP_RANGE, costMatrix) : Infinity;
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
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
//
// Within a priority tier, consumers are visited nearest-first by a greedy walk (route from `from`, then
// from whichever consumer was picked last) rather than the array's incoming order — same-priority
// sinks are the common case (every extension ties on PRIORITY.spawnSystem), and array order comes from
// FIND_MY_STRUCTURES/creep iteration, which has no spatial meaning. Without this a loaded creep's
// multi-dropoff trip zig-zags across the bunker in whatever order the engine happened to return
// structures, instead of walking a short route through the extensions actually near it. `from`/
// `costMatrix` are optional so callers with no route to price (or in tests) keep the old priority-only
// order — a fallback, not a behavior change for them.
function buildDeliverChain(
  consumers: readonly Consumer[],
  remaining: Map<string, number>,
  resource: ResourceConstant,
  available: number,
  from?: XY,
  costMatrix?: RoadCostMatrix
): { ref: NodeRef; amount: number }[] {
  const out: { ref: NodeRef; amount: number }[] = [];
  let left = available;
  let cursor = from;

  // Bucket by priority tier, preserving each tier's original relative order as the no-position fallback.
  const tiers = new Map<number, Consumer[]>();
  for (const c of consumers) {
    if (c.resource !== resource) continue;
    const bucket = tiers.get(c.priority);
    if (bucket) bucket.push(c);
    else tiers.set(c.priority, [c]);
  }
  const priorities = [...tiers.keys()].sort((a, b) => b - a);

  for (const priority of priorities) {
    if (left <= 0) break;
    const pool = tiers.get(priority) ?? [];
    const remainingInTier = new Set(pool);
    let hasStop = out.length > 0; // a higher-priority tier may have already placed a stop this call
    while (remainingInTier.size > 0 && left > 0) {
      const next = cursor && costMatrix ? nearestConsumer(remainingInTier, cursor, costMatrix) : remainingInTier.values().next().value;
      if (!next) break;
      // Once the chain has a stop, don't let it leap clear across the room for the next one — see
      // MAX_CHAIN_HOP's doc. The very first stop overall is never capped (from the creep's own
      // position, on the very first tier processed), since reaching the sole open consumer, however
      // far, is a real trip rather than a hop within an already-claimed cluster.
      if (hasStop && cursor && costMatrix && next.pos) {
        const hop = pathDistance(cursor, next.pos, PICKUP_RANGE, costMatrix);
        if (hop > MAX_CHAIN_HOP) break;
      }
      remainingInTier.delete(next);
      const key = refKey(next.ref);
      const want = remaining.get(key) ?? 0;
      if (want <= 0) continue;
      const give = Math.min(left, want);
      remaining.set(key, want - give);
      out.push({ ref: next.ref, amount: give });
      left -= give;
      hasStop = true;
      if (next.pos) cursor = next.pos;
    }
  }
  return out;
}

// Nearest remaining consumer in this tier to `from`, by real walkable-tile path distance — same metric
// pickNearestFillingProvider uses on the pickup side. A consumer with no position (a creep sink, or a
// storage struct that hasn't been placed yet) sorts last, not first, so a positioned sink is always
// preferred when one's available; ties keep iteration order.
function nearestConsumer(pool: ReadonlySet<Consumer>, from: XY, costMatrix: RoadCostMatrix): Consumer | undefined {
  let best: Consumer | undefined;
  let bestDistance = Infinity;
  for (const c of pool) {
    const d = c.pos ? pathDistance(from, c.pos, PICKUP_RANGE, costMatrix) : Infinity;
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best ?? pool.values().next().value;
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
  return ref.kind === "dropped" || ref.kind === "tombstone" || ref.kind === "ruin";
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
