// What a body costs to spawn. One place, derived from the game's own
// BODYPART_COST table — body formulas state their shapes as part arrays and ask
// this what they cost, rather than carrying a hardcoded number that silently
// drifts out of step the moment a shape changes.

/** Spawn cost of a body, summed from BODYPART_COST. */
export function bodyCost(body: BodyPartConstant[]): number {
  return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

/**
 * The most whole repeats of `set` that `energy` buys, clamped to [min, max].
 *
 * Every set-based body calculator wants this same division, and doing it from
 * the set's derived cost is what keeps the rungs honest: change a set's parts
 * and the energy thresholds move with it automatically.
 */
export function affordableSets(energy: number, set: BodyPartConstant[], min: number, max: number): number {
  const cost = bodyCost(set);
  if (cost === 0) return min;
  return Math.min(max, Math.max(min, Math.floor(energy / cost)));
}

// Ascending survival priority. Screeps consumes body parts in array order —
// body[0] takes every hit until it is destroyed, then body[1] — so a part's
// index *is* how expendable it is, and the last part is the one a creep keeps
// longest.
//
// MOVE ranks above everything: a creep that loses its MOVE parts is stranded
// where it stands, unable to retreat, reposition, or clear a corridor, and a
// stranded creep is a total loss no matter what else survived. HEAL and ATTACK
// follow because they decide fights; the economy parts are replaceable; TOUGH
// leads precisely because absorbing hits is its whole job.
const PART_PRIORITY: BodyPartConstant[] = [TOUGH, WORK, CARRY, CLAIM, RANGED_ATTACK, ATTACK, HEAL, MOVE];

/**
 * The same parts, ordered so the most valuable are destroyed last.
 *
 * Applied once at the seam where a body becomes a spawn intent, so body
 * formulas stay free to express their shape in whatever grouping reads best —
 * per-set, per-pair — without each of them having to remember this rule.
 */
export function orderBody(body: BodyPartConstant[]): BodyPartConstant[] {
  return [...body].sort((a, b) => PART_PRIORITY.indexOf(a) - PART_PRIORITY.indexOf(b));
}

/** Count of a given part in a body — the readable form of a filter+length. */
export function countPart(body: BodyPartConstant[], part: BodyPartConstant): number {
  return body.filter(p => p === part).length;
}

/** `n` copies of `part`, for assembling bodies. */
export function parts(part: BodyPartConstant, n: number): BodyPartConstant[] {
  return new Array<BodyPartConstant>(Math.max(0, n)).fill(part);
}
