// Shared greedy cross-resource pairing (gh #59 fix, ported from behaviors/transportTaskRunner.ts's
// planTransportTask empty-creep branch / pickBestInDirection — see that module's own doc for the original
// incident this shape fixes: a fixed resource-priority order once made a long-starved mineral pickup
// structurally unable to outrank a routine energy hop). Extracted so Transport and Steward both drive
// their own request pool through the EXACT same matching algorithm rather than each maintaining its own
// (Steward's own copy independently regressed — see stewardTaskRunner.ts's planStewardTask history: it
// scored each resource's single best request in isolation with no check that an opposite-signed
// counterpart existed, so a permanently-unfillable want for a never-mined resource could win the race by
// magnitude alone and starve every real, fulfillable request behind it — confirmed live on the pserver,
// gh #59).
//
// The core rule this module exists to enforce: a resource is only ever a candidate if BOTH an output
// (something has it to give) and an input (something wants it delivered) exist for it in the pool right
// now. A one-sided want or have, however large, is never scored and never wins — it simply isn't a
// fulfillable pair yet.

import type { LogisticsRequest } from "./request";

/** One resource's winning output+input pair, scored on the output side's (optionally discounted) rate. */
export interface MatchedPair {
  resource: ResourceConstant;
  output: LogisticsRequest;
  input: LogisticsRequest;
  score: number;
}

/** Every distinct resource present in `pool`, in first-seen order. */
function resourcesInPool(pool: readonly LogisticsRequest[]): ResourceConstant[] {
  const seen = new Set<ResourceConstant>();
  const out: ResourceConstant[] = [];
  for (const r of pool) {
    if (seen.has(r.resource)) continue;
    seen.add(r.resource);
    out.push(r.resource);
  }
  return out;
}

/**
 * Best-scoring request for `resource` among `pool` entries whose sign matches `direction` ("output" =
 * amount < 0, a target HAS resource to give; "input" = amount > 0, a target WANTS resource delivered) —
 * mirrors transportTaskRunner.ts's original pickBestInDirection exactly, generalized to plain
 * `distanceTo`/`amountOf` callbacks instead of a hardcoded RoomPosition/targetedBy dependency, so this
 * module has no dependency on either Transport's targeted-discount system or Steward's fixed-anchor
 * geometry — each caller supplies whichever meaning is appropriate for its own pool (see this module's
 * header and pickBestPair's own doc for why the two callers differ here).
 */
function pickBestInDirection(
  pool: readonly LogisticsRequest[],
  resource: ResourceConstant,
  direction: "input" | "output",
  distanceTo: (request: LogisticsRequest) => number,
  amountOf: (request: LogisticsRequest) => number,
  excludeTargetId?: Id<_HasId>
): LogisticsRequest | undefined {
  let best: LogisticsRequest | undefined;
  let bestScore = -Infinity;
  for (const request of pool) {
    if (request.resource !== resource) continue;
    if (direction === "output" ? request.amount >= 0 : request.amount <= 0) continue;
    if (excludeTargetId !== undefined && request.target.id === excludeTargetId) continue;
    const amount = amountOf(request);
    if (amount <= 0) continue;
    const score = (request.multiplier * amount) / Math.max(1, distanceTo(request));
    if (score > bestScore) {
      best = request;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Greedy cross-resource pairing: for each resource in `pool`, finds the best output candidate SEPARATELY
 * from the best input candidate, skips the resource entirely if either side is missing (the whole point
 * of this module — see header), scores the surviving pair on the output side's `amountOf`/`distanceFromCreep`
 * rate, and returns the single best-scoring pair across every resource. `undefined` if no resource in the
 * pool has both a real output and a real input right now.
 *
 * Two distance functions, not one — mirrors transportTaskRunner.ts's original two-stage lookup exactly:
 * the output candidate is ranked by distance FROM THE CREEP (`distanceFromCreep`), but the input
 * (delivery) candidate is ranked by distance FROM THE CHOSEN OUTPUT's target (`distanceFromOutput`) —
 * once a creep commits to a particular pickup, the best place to deliver is judged from THAT pickup
 * point, not from the creep's current position. Collapsing these into a single distance function would
 * silently change which delivery target wins whenever a pool has more than one candidate on either side.
 *
 * The input search excludes the chosen output's own target (a same-structure withdraw+deliver pair is
 * never a real route — matters for a pool where one structure can carry BOTH an implicit output and
 * input request for the same resource, e.g. Steward's storage always offering "has energy" and "wants
 * energy" simultaneously so the anchor link's drain/top-up legs have a real pairing partner — see
 * stewardRegister.ts's registerStorageEnergyRequests).
 *
 * `amountOf` is injected per-request so a caller can price a predicted-claim discount (Transport:
 * `r => discountedAmount(r, targetedBy, creep)`) or skip it (default `Math.abs(request.amount)`, what
 * Steward uses — it has no sibling creeps competing for its own anchor pool to discount against).
 */
export function pickBestPair(
  pool: readonly LogisticsRequest[],
  distanceFromCreep: (request: LogisticsRequest) => number,
  amountOf: (request: LogisticsRequest) => number = r => Math.abs(r.amount),
  distanceFromOutput: (output: LogisticsRequest, input: LogisticsRequest) => number = distanceFromCreep
): MatchedPair | undefined {
  let best: MatchedPair | undefined;
  for (const resource of resourcesInPool(pool)) {
    const output = pickBestInDirection(pool, resource, "output", distanceFromCreep, amountOf);
    if (!output) continue;
    const input = pickBestInDirection(
      pool,
      resource,
      "input",
      r => distanceFromOutput(output, r),
      amountOf,
      output.target.id as Id<_HasId>
    );
    if (!input) continue;

    const score = (output.multiplier * amountOf(output)) / Math.max(1, distanceFromCreep(output));
    if (!best || score > best.score) {
      best = { resource, output, input, score };
    }
  }
  return best;
}
