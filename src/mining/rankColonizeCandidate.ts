// Combines a candidate room's ColonizationPotential (pure map-topology energy value, see
// summarizeNeighborhoodPotential.ts) with a flat mineral-access bonus into the single comparable number
// pickColonyTargets ranks candidates by. Pure — no Game.*, no Memory reads; every input is passed in.

import type { ColonizationPotential } from "../memory/schema";

// Flat bonus per distinct mineral type the empire doesn't already have access to. No real market/lab
// pricing model exists yet (see summarizeNeighborhoodPotential.ts's own note on keeperMinerals being
// informational-only) — this is a deliberately crude, tunable placeholder that lets minerals move the
// ranking without pretending a precision the rest of the economy can't back up yet.
export const NEW_MINERAL_BONUS = 5;

// Doubled when the mineral sits in the candidate room itself (an owned room's own mineral, once claimed,
// is directly mineable the same tick — a neighboring keeper room's mineral needs keeper-room mining,
// a capability that doesn't exist yet, so it's worth less today despite scoring the same base bonus).
const OWN_ROOM_MULTIPLIER = 2;

export interface MineralScoreInput {
  potential: ColonizationPotential;
  // The candidate room's OWN mineral (if any) — distinct from potential.keeperMinerals, which lists
  // minerals in the candidate's neighboring keeper rooms, not the candidate room itself.
  ownMineral?: MineralConstant;
  // Minerals the empire already has access to (Colony.getMinerals(), unioned across every owned colony)
  // — a mineral type already represented scores no bonus; only a genuinely new type does.
  haveMinerals: ReadonlySet<MineralConstant>;
}

/** Single comparable score for ranking colonize candidates: energy-equivalent potential (normal + keeper
 * remote-mining value) plus a flat bonus per new mineral type this candidate would unlock, doubled for
 * the candidate's own room mineral. */
export function colonizePotentialScore(input: MineralScoreInput): number {
  const { potential, ownMineral, haveMinerals } = input;
  let score = potential.normal + potential.keeper;

  if (ownMineral && !haveMinerals.has(ownMineral)) {
    score += NEW_MINERAL_BONUS * OWN_ROOM_MULTIPLIER;
  }
  for (const mineral of potential.keeperMinerals) {
    if (!haveMinerals.has(mineral)) score += NEW_MINERAL_BONUS;
  }
  return score;
}
