// Turns a resolved boost tier + a role's boostable-action list (Role.boostable, see behaviors/roles/role.ts)
// into a compound->amount map, sized against a SPECIFIC creep body rather than a flat per-action constant
// (gh #61 epic, gh #66). This is the data CreepRequest.boostNeeds carries: computed once here, on the
// colony/request side, so empire-scope logistics code never has to reach back into role/body internals to
// figure out what it's summing across colonies.
//
// The real engine boosts LAB_BOOST_MINERAL (30, node_modules/@screeps/common/lib/constants.js) units of
// compound PER BODY PART actually boosted — not per action, not a flat amount per creep. A creep with 3
// TOUGH parts needs 3x what a creep with 1 TOUGH part needs for the same tier.
//
// Two boostable actions could in principle resolve to the same (bodyPart, tier) line only if a role listed
// both an action's verb AND its body part's single-action alias for the SAME line (e.g. boostable:
// ["tough", "damage"] — see boostActions.ts's header on that alias). No current role does this: every
// Role.boostable list names each action once. Accumulating with `+=` rather than overwriting is still the
// correct behavior if it ever did happen (two requested actions that both cash out to the same compound
// should sum, not clobber) — see boostActions.ts's alias section for why the collision can't happen through
// two GENUINELY DIFFERENT actions, only through a hypothetical duplicate-alias listing.

import { boostActionFor } from "./boostActions";

/** Computes how much of each compound a specific creep body needs to reach `tier` on every action in
 * `boostableActions` (typically a role's static `boostable` list). An action not found in the engine's
 * BOOSTS table, or whose body part has zero copies in `body`, contributes nothing rather than erroring —
 * both are "this boost doesn't apply here" cases, not failures. An empty `boostableActions` list always
 * returns an empty map. */
export function computeBoostNeeds(
  boostableActions: readonly string[],
  body: readonly BodyPartConstant[],
  tier: 1 | 2 | 3
): Partial<Record<ResourceConstant, number>> {
  const needs: Partial<Record<ResourceConstant, number>> = {};
  for (const action of boostableActions) {
    const resolved = boostActionFor(action);
    if (resolved.kind === "not-found") continue;

    const partCount = body.filter(part => part === resolved.bodyPart).length;
    if (partCount === 0) continue; // body doesn't actually have this part — nothing to boost

    const compound = resolved[`T${tier}` as const];
    needs[compound] = (needs[compound] ?? 0) + partCount * LAB_BOOST_MINERAL;
  }
  return needs;
}
