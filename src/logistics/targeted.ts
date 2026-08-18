// The targetedBy-equivalent (gh #49, ADR 0008's "drop travelHome's hard reservation-span guard" and
// "targetedBy is derived fresh each tick, not a write-time cache" sections): which live creeps are
// currently routed toward a given target, derived FRESH every planning pass by scanning every live
// creep's persisted current Task (task.ts's resolveTask) — never a cache written at assignment time and
// invalidated later. Mirrors allocate.ts's ReservedAmounts/foldReserved folding pattern (scan live
// creep memory once per pass, fold into a ref-keyed map) but keyed by live object id rather than NodeRef,
// since this layer's targets are live objects, not snapshot NodeRefs (see request.ts's header).
//
// This module only builds the map and prices the discount; it does not decide which creeps to scan
// (a caller passes whatever creep list is relevant to its own pool — Transport, Steward, ...) and does
// not touch ReservedAmounts/refKey/allocate.ts, which stay owned by the old, still-live system.

import { resolveTask, type Task } from "./task";
import type { LogisticsRequest } from "./request";

/** One live creep's Task leg targeting something, alongside the creep carrying it (for influx pricing). */
export interface TargetingLeg {
  creep: Creep;
  task: Task;
}

/** Every live creep currently routed toward a given target, keyed by that target's id. */
export type TargetedBy = Map<Id<_HasId>, TargetingLeg[]>;

// Every leg of a chain targets something (a withdraw leg's source, a transfer leg's sink) — walking the
// whole parent chain, not just the current leg, means a creep already committed to a 2-leg remote
// pickup-then-deliver route discounts BOTH its withdraw target and its eventual deliver target, not only
// whichever leg it happens to be working this instant. That's deliberate: a spawn awaiting a remote
// delivery should already read as "less needy" well before the transporter has even picked up.
function addChain(map: TargetedBy, creep: Creep, task: Task): void {
  let leg: Task | undefined = task;
  while (leg) {
    const id = leg.target.id as Id<_HasId>;
    const entry: TargetingLeg = { creep, task: leg };
    const existing = map.get(id);
    if (existing) existing.push(entry);
    else map.set(id, [entry]);
    leg = leg.parent;
  }
}

/**
 * Scans `creeps`' persisted `memory.logisticsTask` fresh and folds every live leg's target into a
 * ref-keyed map — the same "scan live memory once per planning pass" shape as allocate.ts's
 * foldReserved, adapted to live-object ids instead of NodeRef strings (see this module's header).
 * A creep with no persisted task, or one whose task no longer resolves (dead target — see
 * task.ts's resolveTask), contributes nothing. Safe to call every planning pass: nothing here is
 * written back to Memory, so there is no invalidation to get wrong.
 */
export function buildTargetedBy(creeps: readonly Creep[]): TargetedBy {
  const map: TargetedBy = new Map();
  for (const creep of creeps) {
    const persisted = creep.memory.logisticsTask;
    if (!persisted) continue;
    const task = resolveTask(persisted);
    if (!task) continue;
    addChain(map, creep, task);
  }
  return map;
}

/**
 * Overmind's `predictedAmount = max(predictedAmount - resourceInflux, 0)` (LogisticsNetwork.ts:403-447,
 * see ADR 0008): every OTHER creep already targeting `request.target` for `request.resource` (excluding
 * `exclude`, so a creep re-ranking its own already-assigned request doesn't discount itself away) has its
 * carry capacity subtracted from the request's remaining amount, clamped at 0. A soft discount, not a
 * hard lock — the request still exists and can still win a second creep's ranking pass if the first
 * creep's predicted delivery doesn't cover the full remaining need.
 *
 * "Incoming amount" per targeting creep is approximated as that creep's full carry capacity for
 * `request.resource` (the most it could possibly bring/take on this leg), a deliberately conservative
 * upper bound: a creep that ultimately arrives with less than a full load discounts the request less at
 * plan time than it will actually cover, but never more. Mirrors Overmind's own resourceInFlight, which
 * likewise budgets off the transporter's carry rather than tracking a partially-filled realtime amount.
 * A creep targeting the same target twice (e.g. a chain that both withdraws from and — degenerately —
 * delivers to the same object) is only counted once, since it can only carry one load's worth at a time.
 */
export function discountedAmount(request: LogisticsRequest, targetedBy: TargetedBy, exclude?: Creep): number {
  const remaining = Math.abs(request.amount);
  const legs = targetedBy.get(request.target.id as Id<_HasId>);
  if (!legs || legs.length === 0) return remaining;

  let influx = 0;
  const counted = new Set<Creep>();
  for (const { creep, task } of legs) {
    if (task.resource !== request.resource) continue;
    if (creep === exclude) continue;
    if (counted.has(creep)) continue;
    counted.add(creep);
    influx += creep.store.getCapacity(request.resource) ?? 0;
  }
  return Math.max(0, remaining - influx);
}

/**
 * `scoreRequest`'s rate formula (`multiplier * amount / distance`), but scored against
 * `discountedAmount` instead of the request's raw amount — so a request already being served reads as
 * less urgent on THIS creep's ranking pass without mutating the request itself (the discount is
 * recomputed fresh from `targetedBy` every call, never written back). A discounted amount of 0 scores 0,
 * not skipped outright: the request is still real, just entirely covered by incoming deliveries for now.
 */
export function scoreDiscountedRequest(
  request: LogisticsRequest,
  distance: number,
  targetedBy: TargetedBy,
  exclude?: Creep
): number {
  const amount = discountedAmount(request, targetedBy, exclude);
  return (request.multiplier * amount) / Math.max(1, distance);
}

/**
 * `pickBestRequest` (request.ts), but ranking by `scoreDiscountedRequest` instead of the raw rate — see
 * gh #49/ADR 0008's predicted-amount discount. `exclude` should be the creep doing the ranking, so a
 * creep re-evaluating a request it is itself already routed toward isn't discounted by its own claim
 * (that would make an already-assigned request look artificially unattractive to the very creep working
 * it). Same greedy single-sided shape and same "undefined if nothing matches or is reachable" contract
 * as pickBestRequest — this does not add two-sided matching (see ADR 0008's Out of Scope).
 */
export function pickBestDiscountedRequest(
  requests: readonly LogisticsRequest[],
  resource: ResourceConstant,
  distanceTo: (target: _HasId & { pos: RoomPosition }) => number | null,
  targetedBy: TargetedBy,
  exclude?: Creep
): LogisticsRequest | undefined {
  let best: LogisticsRequest | undefined;
  let bestScore = -Infinity;
  for (const request of requests) {
    if (request.resource !== resource) continue;
    const distance = distanceTo(request.target);
    if (distance === null) continue;
    const score = scoreDiscountedRequest(request, distance, targetedBy, exclude);
    if (score > bestScore) {
      best = request;
      bestScore = score;
    }
  }
  return best;
}
