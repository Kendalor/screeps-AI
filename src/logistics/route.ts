// Buffer-detour route evaluation (gh #47, ADR 0008's "port buffer-detour evaluation now" decision):
// extends gh #46's single-leg scoreRequest so a request is scored across multiple candidate ROUTES, not
// just the direct-to-target distance. Mirrors Overmind's LogisticsNetwork.bufferChoices() — for a request
// where the target WANTS a resource delivered (a requestInput, positive amount), a creep that isn't
// already carrying enough can beat a direct trip by swinging through storage/terminal first to load up,
// provided the extra leg1 distance is still outweighed by delivering more amount, sooner, than direct
// would. This module only evaluates and picks a route; it doesn't run one — the winning route is handed
// back as a fork()-ed Task chain (logistics/task.ts) ready to assign to a creep the same way
// __assignLogisticsTaskChain already does by hand.
//
// Buffer discovery is the caller's job, not this module's: it takes `buffers` as a plain list (storage
// and/or terminal, whichever the caller's room currently has built) rather than looking them up itself —
// keeps this module free of Game.* room lookups, consistent with request.ts/task.ts staying
// infra-only and letting a register.ts-style call site own live-object discovery (mirrors
// LogisticsNetwork.buffers being assembled once by its caller, not re-discovered per request).

import { fork, type Task } from "./task";
import type { LogisticsRequest } from "./request";

/** A live structure/object that can act as a buffer detour stop — must expose a resource store to cap
 * how much a creep can actually load there (a dropped pile can't be swung by on the way, only a
 * store-bearing structure can). */
export type Buffer = _HasId & {
  pos: RoomPosition;
  store: { getUsedCapacity(resource: ResourceConstant): number | null };
};

/** One scored candidate route for a request: either direct (`viaBuffer` undefined) or a 2-leg detour
 * through `viaBuffer` first. `amount` is the resource actually deliverable/collectable on this route,
 * already capped by carry space and (for a detour) the buffer's own available amount — never the
 * request's raw amount, since that's the whole reason a route needs its own score instead of reusing
 * scoreRequest's single-leg one. */
export interface RouteCandidate {
  viaBuffer?: Buffer;
  distance: number;
  amount: number;
  score: number;
}

const MIN_DISTANCE = 1;

/**
 * Scores a direct-to-target route: a direct trip has no stop to load up at, so the deliverable amount is
 * capped by what the creep is ALREADY carrying (`carrying`), never the full carry `capacity` — that's the
 * mechanical reason a buffer detour can ever beat direct for a delivery request (see bufferRoute below).
 */
function directRoute(request: LogisticsRequest, distance: number, carrying: number): RouteCandidate {
  const amount = Math.min(Math.abs(request.amount), carrying);
  const dist = Math.max(MIN_DISTANCE, distance);
  return { distance: dist, amount, score: (request.multiplier * amount) / dist };
}

/**
 * Scores a via-`buffer` detour route for a delivery request (target wants `resource`): leg1 is
 * creep-to-buffer, leg2 is buffer-to-target, distance is their sum (Overmind's bufferChoices() shape — no
 * discount for the extra leg beyond the raw distance cost). Because the creep tops up at the buffer, the
 * deliverable amount is capped by full carry `capacity` (not merely `carrying`), the request's own
 * remaining amount, and what the buffer actually holds — a detour that outruns the buffer's stock can't
 * deliver more than the buffer has to give.
 */
function bufferRoute(
  request: LogisticsRequest,
  buffer: Buffer,
  distanceToBuffer: number,
  distanceBufferToTarget: number,
  capacity: number
): RouteCandidate {
  const bufferHas = buffer.store.getUsedCapacity(request.resource) ?? 0;
  const amount = Math.min(Math.abs(request.amount), capacity, bufferHas);
  const dist = Math.max(MIN_DISTANCE, distanceToBuffer + distanceBufferToTarget);
  return { viaBuffer: buffer, distance: dist, amount, score: (request.multiplier * amount) / dist };
}

/**
 * Evaluates every candidate route for `request` from a creep at `from`, returning every route scored,
 * direct first then one per buffer, unsorted. `carrying` is how much of `request.resource` the creep
 * already holds (caps the direct route — see directRoute); `capacity` is its total store capacity for
 * that resource (caps a buffer route, since the creep loads up there — see bufferRoute); `capacity` is
 * always >= `carrying`. `distanceTo` is injected the same way pickBestRequest's is (see request.ts) so
 * this stays free of PathFinder/room machinery; buffers with no reachable distance to either leg are
 * skipped rather than scored at distance Infinity.
 */
export function evaluateRoutes(
  request: LogisticsRequest,
  from: RoomPosition,
  buffers: readonly Buffer[],
  carrying: number,
  capacity: number,
  distanceTo: (a: RoomPosition, b: RoomPosition) => number | null
): RouteCandidate[] {
  const routes: RouteCandidate[] = [];

  const directDistance = distanceTo(from, request.target.pos);
  if (directDistance !== null) routes.push(directRoute(request, directDistance, carrying));

  // A buffer detour only makes sense for a delivery request (target wants resource, positive amount) —
  // withdrawing FROM a target has no reason to route through a third structure first (Overmind's
  // bufferChoices() is likewise only consulted from requestInput's scoring path). Skip detours entirely
  // for an output request rather than scoring a meaningless route.
  if (request.amount <= 0) return routes;

  for (const buffer of buffers) {
    const toBuffer = distanceTo(from, buffer.pos);
    const bufferToTarget = distanceTo(buffer.pos, request.target.pos);
    if (toBuffer === null || bufferToTarget === null) continue;
    routes.push(bufferRoute(request, buffer, toBuffer, bufferToTarget, capacity));
  }

  return routes;
}

/**
 * Picks the best-scoring route from `evaluateRoutes` and turns it into a ready-to-assign Task chain:
 * direct is a single transfer leg; a buffer detour is a withdraw-at-buffer leg forked into a
 * transfer-at-target leg (outermost/current task first, matching task.ts's fork() direction — the
 * withdraw runs now, the transfer resumes as `.parent` once the withdraw completes). Returns undefined
 * when no route is reachable at all.
 */
export function pickBestRoute(
  request: LogisticsRequest,
  from: RoomPosition,
  buffers: readonly Buffer[],
  carrying: number,
  capacity: number,
  distanceTo: (a: RoomPosition, b: RoomPosition) => number | null
): { route: RouteCandidate; task: Task } | undefined {
  const routes = evaluateRoutes(request, from, buffers, carrying, capacity, distanceTo);
  if (routes.length === 0) return undefined;

  let best = routes[0];
  for (const route of routes) if (route.score > best.score) best = route;

  const deliver: Task = { kind: "transfer", target: request.target, resource: request.resource };
  if (!best.viaBuffer) return { route: best, task: deliver };

  const withdraw: Task = { kind: "withdraw", target: best.viaBuffer, resource: request.resource };
  return { route: best, task: fork(withdraw, deliver) };
}
