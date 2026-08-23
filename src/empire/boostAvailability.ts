// Tier-walk over empire-wide boost stock (gh #67, epic #61): given a role's required boost actions, walks
// tiers from best (T3) to worst (T1) and returns the best tier the empire can currently actually supply for
// EVERY required action, or a clear "unavailable" result if none of the three tiers clears the bar for all
// of them. This is deliberately NOT the same file as boostTier.ts (that one parses a flag's ":T3" tier-
// suffix segment — a string-parsing concern with zero stock/action knowledge) — this file is the
// availability check the epic's "Testing Decisions" section calls out as its own seam, checked against
// empire-wide stock (empire/logistics.ts's availableEmpireStock), not any one sponsoring colony's local
// store.
//
// Two dependencies are injected rather than imported directly, both by design (see the epic's guidance):
//
// 1. `resolveCompound(action, tier)` — "which compound is T1/T2/T3 for this action" is #62's job
//    (empire/boostActions.ts's boostActionFor). That file didn't exist yet when this ticket was built (only
//    its test did, mid-flight from a concurrent agent), so wiring it in directly would have blocked this
//    ticket on another ticket's unfinished API. Accepting it as a plain `(action, tier) => ResourceConstant
//    | undefined` function keeps this module importable and unit-testable today with fabricated compound
//    tables, AND is a shape boostActionFor's real `{kind:"found", T1, T2, T3}` result trivially adapts to
//    at the call site later (`(action, tier) => boostActionFor(action)[kind==="found" ? `T${tier}` : ...]`)
//    — no rework needed here once #62 lands, only a thin adapter at the caller.
//
// 2. `neededAmount` — "how much of the compound is needed" is #66's job (CreepRequest.boostNeeds) and this
//    ticket explicitly isn't responsible for sourcing that number (see issue body). A single flat
//    amount-per-action-and-tier isn't quite right long-term (a heal-heavy body needs more LO than a
//    one-part sprinkle), but per the issue's own suggestion this ticket accepts the simplest correct
//    surface for its actual job — "does stock clear a bar" — as a single flat number applied uniformly to
//    every required action at every tier. #68's sponsor-pick wrapper (or a future revision of this
//    function) is where a real per-action amount map gets threaded through; this signature can grow a
//    `neededAmountFor(action, tier)` function parameter later without changing the tier-walk logic itself.
//
// availableStock is intentionally just `(resource) => number`, not the raw ColonyEmpireStock[] — the
// caller is expected to close over empire/logistics.ts's availableEmpireStock (or Game.market stock, or a
// test stub) exactly like every other "stay pure, take the query as a function" module in this codebase
// (computeEmpireRequests' roleOf, matchEmpireRequests' receiverFreeCapacity).
//
// #62 (empire/boostActions.ts's boostActionFor) has since landed, so `resolveCompoundViaBoostActions`
// below adapts its real `{kind:"found", T1, T2, T3}` result shape into the `resolveCompound` function this
// module's core (`pickAvailableTier`) expects — the real, final integration point a caller should use,
// per this ticket's own guidance to prefer wiring to #62 directly once available. `pickAvailableTier`
// itself stays on the injected-function signature: it's the pure, unit-testable core, and the adapter is
// the only piece that needs to know boostActionFor exists.

import { boostActionFor } from "./boostActions";

export type BoostAvailability = { kind: "available"; tier: 1 | 2 | 3 } | { kind: "unavailable" };

const TIERS: readonly (1 | 2 | 3)[] = [3, 2, 1];

/**
 * Walks T3 -> T2 -> T1 and returns the best tier where EVERY action in `requiredActions` resolves to a
 * compound with at least `neededAmount` empire-wide stock. An action that doesn't resolve to any compound
 * at a given tier (resolveCompound returns undefined) counts as failing that tier — there's nothing to
 * check stock for, so it can never clear the bar. Returns `{kind: "unavailable"}`, never a default/fallback
 * tier, when no tier clears the bar for all actions (including when `requiredActions` resolves to nothing
 * checkable at any tier).
 */
export function pickAvailableTier(
  requiredActions: readonly string[],
  resolveCompound: (action: string, tier: 1 | 2 | 3) => ResourceConstant | undefined,
  availableStock: (resource: ResourceConstant) => number,
  neededAmount: number
): BoostAvailability {
  for (const tier of TIERS) {
    const allClear = requiredActions.every(action => {
      const compound = resolveCompound(action, tier);
      if (compound === undefined) return false;
      return availableStock(compound) >= neededAmount;
    });
    if (allClear) return { kind: "available", tier };
  }
  return { kind: "unavailable" };
}

/** Real `resolveCompound` adapter over #62's boostActionFor — an unknown action or a boost line that
 * doesn't resolve (boostActionFor's `not-found`) simply has no compound at any tier, same as this
 * module's fabricated test tables treating a missing entry as undefined. */
export function resolveCompoundViaBoostActions(action: string, tier: 1 | 2 | 3): ResourceConstant | undefined {
  const result = boostActionFor(action);
  if (result.kind === "not-found") return undefined;
  return result[`T${tier}` as const];
}
