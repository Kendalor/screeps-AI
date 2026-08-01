// Sums remotePotential/keeperPotential over a candidate anchor's own neighborhood — the map-topology
// colonization score cached on ScoutInfo.potential (see memory/schema.ts's doc for what it does and
// doesn't account for: pure topology, no live owner/hostile filtering, computed once and cached forever).
//
// Deliberately takes ScoutCandidate[] (the same shape scoutGraph.ts's scoutCandidatesAround returns) as
// plain data rather than touching Game.* itself — the BFS that builds this list has to run once per
// candidate room, not once per colony, so it's the caller's job (execute.ts, which already reaches
// Game.map for resolveScoutedAnchor) to walk scoutCandidatesAround(candidateRoom, MAX_REMOTE_HOPS) and
// hand the result in here. Keeping the summing pure means it's unit-testable off plain fixtures, same as
// every other planner in this codebase.

import { MAX_REMOTE_HOPS } from "./pickRemotes";
import { remotePotential } from "./remotePotentialTable";
import { keeperPotential } from "./keeperPotentialTable";
import type { ScoutCandidate } from "../snapshot/types";
import type { ColonizationPotential } from "../memory/schema";

/** Is every room within MAX_REMOTE_HOPS of this candidate already scouted (has a ScoutInfo record)?
 * summarizePotential's neighborhood is only trustworthy once this is true — an unscouted neighbor
 * silently contributes 0, understating a candidate whose best neighbor just hasn't been surveyed yet. The
 * candidate room itself (distance 0) is excluded from this check: it's summarizePotential's caller, not
 * one of its own neighbors, and may itself be mid-observation the same tick this runs. */
export function neighborhoodFullyScouted(candidates: readonly ScoutCandidate[]): boolean {
  return candidates.every(c => c.distance === 0 || c.info !== undefined);
}

/** Sums normal/keeper remote-mining potential across every unowned, non-hostile neighbor within
 * MAX_REMOTE_HOPS — the candidate room itself (distance 0) excluded, since a room is never its own
 * remote. Call only once neighborhoodFullyScouted is true; an incomplete neighborhood undercounts. */
export function summarizePotential(candidates: readonly ScoutCandidate[]): ColonizationPotential {
  let normal = 0;
  let keeper = 0;
  const keeperMinerals = new Set<MineralConstant>();
  for (const cand of candidates) {
    if (cand.distance === 0 || cand.distance > MAX_REMOTE_HOPS) continue;
    const info = cand.info;
    if (!info || info.owner || info.hostile) continue;
    if (info.type === "normal") {
      normal += remotePotential(info.sources.length, cand.distance);
    } else if (info.type === "keeper") {
      keeper += keeperPotential(cand.distance);
      if (info.mineral) keeperMinerals.add(info.mineral);
    }
  }
  return { normal, keeper, keeperMinerals: [...keeperMinerals] };
}
