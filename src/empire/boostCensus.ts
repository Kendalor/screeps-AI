// Pure predicate over a colony's per-tick request census (gh #69, part of the #61 boosting epic).
// desiredCreeps()-shaped output (src/spawn/request.ts's CreepRequest[]) is scanned for requests whose
// memory.boosts (gh #63's schema field) is non-empty — a pending boost order stamped on the creep before
// it's ever spawned. This exists so later tickets can fire the emergency compound pull the moment an
// operation *requests* a boosted creep, without waiting for the spawn arbiter to actually pick the
// request up (arbiter selection is priority/budget driven and may not happen this tick, or ever, if the
// colony can't afford it — but the boost need is real regardless).
//
// Returns the matching subset rather than a boolean: the acceptance criteria calls for identifying WHICH
// request(s) carry the boost order, and callers of a "should I start pulling compounds" check plausibly
// also want to know what to pull for / how many — a boolean would throw that away for no benefit (the
// array's truthiness already answers the yes/no question via `.length > 0`).
import type { CreepRequest } from "../spawn/request";

export function boostedRequestsInCensus(requests: readonly CreepRequest[]): CreepRequest[] {
  return requests.filter(r => (r.memory.boosts?.length ?? 0) > 0);
}
