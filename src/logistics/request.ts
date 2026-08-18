// The LogisticsRequest type (gh #46, ADR 0008): one signed unit of transport demand, replacing
// graph.ts's separate Provider/Consumer interfaces (see CONTEXT.md's LogisticsRequest entry). Overmind's
// `dQ/dt` rate shape ranks requests by `multiplier * amount / distance` so a request's score grows with
// real urgency (a large or long-starved amount) instead of being capped by a fixed priority tier. This is
// the single-pool core only — no buffer detours (see gh #47), no targetedBy discount (see gh #49), and
// not yet wired to the live Transport role (see gh #52). Proven against exactly one resource (energy) and
// one registration source (a miner's source container) per the PRD's scoped acceptance criteria.

/** One signed unit of transport demand: a live target wants (positive) or has to give (negative) `resource`. */
export interface LogisticsRequest {
  target: _HasId & { pos: RoomPosition };
  resource: ResourceConstant;
  // Positive = target wants `amount` delivered; negative = target has `-amount` available to withdraw.
  amount: number;
  // dAmountdt: how fast `amount` is changing on its own (e.g. a miner's known harvest rate). Zero for a
  // static pile/container with no ongoing accrual.
  dAmountdt: number;
  // Urgency scaling factor applied on top of amount/distance. Defaults to 1 in both constructors below.
  multiplier: number;
}

const DEFAULT_MULTIPLIER = 1;

/** Builds a request for a target that WANTS `resource` delivered (positive amount). */
export function requestInput(
  target: _HasId & { pos: RoomPosition },
  resource: ResourceConstant,
  amount: number,
  dAmountdt = 0,
  multiplier: number = DEFAULT_MULTIPLIER
): LogisticsRequest {
  return { target, resource, amount, dAmountdt, multiplier };
}

/** Builds a request for a target that HAS `resource` available to give (negated to a negative amount). */
export function requestOutput(
  target: _HasId & { pos: RoomPosition },
  resource: ResourceConstant,
  amount: number,
  dAmountdt = 0,
  multiplier: number = DEFAULT_MULTIPLIER
): LogisticsRequest {
  return { target, resource, amount: -amount, dAmountdt: -dAmountdt, multiplier };
}

/**
 * A request's score for a creep at `from`: `multiplier * amount / distance` (Overmind's dQ/dt shape).
 * `amount` defaults to the request's own signed-then-absolute amount, but a caller pricing a specific
 * route (see route.ts's directRoute/bufferRoute) can pass the amount actually deliverable on that route
 * instead — capped by carry space/buffer stock, never more than the request's raw amount would allow.
 * Distance is real path length in tiles (see rankRequests), never 0 (a request whose target the creep is
 * already standing on scores as distance 1, not Infinity).
 */
export function scoreRequest(request: LogisticsRequest, distance: number, amount = Math.abs(request.amount)): number {
  return (request.multiplier * amount) / Math.max(1, distance);
}

/**
 * Greedy single-sided pick (no two-sided stable matching — see ADR 0008): among `requests` matching
 * `resource`, returns the one with the best `scoreRequest`, direct-to-target only (no buffer detour —
 * see gh #47). `distanceTo` is injected so callers can price real path length (PathFinder-backed in the
 * live bot) without this module depending on room/pathing machinery itself. Undefined if nothing matches
 * or every candidate is unreachable (`distanceTo` returning null).
 */
export function pickBestRequest(
  requests: readonly LogisticsRequest[],
  resource: ResourceConstant,
  distanceTo: (target: _HasId & { pos: RoomPosition }) => number | null
): LogisticsRequest | undefined {
  let best: LogisticsRequest | undefined;
  let bestScore = -Infinity;
  for (const request of requests) {
    if (request.resource !== resource) continue;
    const distance = distanceTo(request.target);
    if (distance === null) continue;
    const score = scoreRequest(request, distance);
    if (score > bestScore) {
      best = request;
      bestScore = score;
    }
  }
  return best;
}
