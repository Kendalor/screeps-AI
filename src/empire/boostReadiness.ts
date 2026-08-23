// Boost lab readiness scoring + scarcity tie-break (gh #61 epic, gh #73 sub-ticket). Two small pure
// functions, deliberately independent of the allocation pass that will consume them (gh #74) and of
// CreepMemory.boosts (gh #63) itself — both take fabricated inputs so they're testable standalone with no
// ColonySnapshot/live-lab dependency, same "plain stubs in tests" style as empire/logistics.ts's
// EmpireStock/matchEmpireRequests.
//
// readinessScore answers "how many of this creep's needed compounds are ALREADY stocked and ready to fire
// right now" — a lab counts only when it holds the exact needed compound in at least the needed amount;
// wrong compound or too little of the right one doesn't count (a lab mid-stocking isn't ready).
//
// resolveScarcity answers the anti-stalemate question this scoring exists for: when more creeps want a
// boost than there are free labs to grant one to, splitting stocking effort evenly across every contender
// would leave all of them stuck forever at "almost ready, never complete" (each order needs several
// compounds stocked before ANY of them can fire — a lab half-committed to two orders finishes neither).
// Committing scarce capacity to whichever order is already closest to complete (highest readinessScore)
// finishes that order soonest, freeing the lab back up for the next contender instead of every contender
// stalling in lockstep.

/** One lab's current stock, as read at scoring time. `resource`/`amount` describe what's stocked THERE
 * right now, independent of what any creep's order actually wants — readinessScore is what cross-references
 * the two. */
export interface LabState {
  labId: string; // or Id<StructureLab>
  resource?: ResourceConstant; // what's currently stocked in this lab, if any
  amount: number; // how much is stocked
}

/** One compound a creep's pending boost order needs, and how much of it the boost application requires. */
export interface BoostOrderNeed {
  compound: ResourceConstant;
  amount: number; // how much this creep's order needs of this compound
}

/**
 * Counts how many of `needs` already have a lab stocked with the right compound in at least the needed
 * amount. Each need is counted at most once even if several labs stock it (there's nothing to gain from a
 * second lab holding the same already-satisfied compound); a lab holding the wrong compound, or too little
 * of the right one, doesn't satisfy anything. Order-independent — this is a readiness COUNT, not a specific
 * lab assignment (which labs actually feed which creep is gh #74's allocation pass, not this function's
 * job).
 */
export function readinessScore(needs: readonly BoostOrderNeed[], labs: readonly LabState[]): number {
  let score = 0;
  for (const need of needs) {
    const satisfied = labs.some(lab => lab.resource === need.compound && lab.amount >= need.amount);
    if (satisfied) score++;
  }
  return score;
}

/** One contending creep's precomputed readiness score (see readinessScore) — fabricated directly in tests,
 * with no requirement that it actually came from a real BoostOrderNeed/LabState pass. */
export interface ReadinessEntry {
  creepId: string; // or Id<Creep>
  score: number;
}

/**
 * Given more contending creeps than there are free labs to grant, returns the winning subset: highest
 * readinessScore first, up to `freeLabs` entries, so scarce lab capacity commits to whichever order will
 * actually finish soonest (see this file's header for why — the anti-stalemate rule the issue calls for).
 *
 * Ties are broken by ASCENDING lexicographic creepId order. Chosen because it's the same "deterministic,
 * no extra input needed" shape empire/logistics.ts's matchEmpireRequests already relies on for its own
 * pairwise ordering: a tie must resolve identically every tick regardless of the entries' input order, or
 * the winner would flicker tick-to-tick with nothing about the underlying state having changed. Breaking by
 * something like "oldest order first" would need a timestamp this module doesn't carry; creepId is always
 * available and needs no extra bookkeeping.
 */
export function resolveScarcity(entries: readonly ReadinessEntry[], freeLabs: number): ReadinessEntry[] {
  if (freeLabs <= 0) return [];

  const sorted = [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.creepId < b.creepId ? -1 : a.creepId > b.creepId ? 1 : 0;
  });

  return sorted.slice(0, freeLabs);
}
