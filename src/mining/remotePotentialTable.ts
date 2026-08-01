// Precomputed avg net energy/tick a colonization candidate's neighboring room is worth, purely as a
// function of (source count, hop distance) — the cheap heuristic expansion scoring uses instead of a real
// PathFinder search per neighbor, because scoring "remote potential" means pricing every unowned neighbor
// of every candidate anchor, a combinatorial volume pickRemotes never has to pay (it only prices one
// colony's own neighbors). Built on remoteEconomics' netEnergy — same formula pickRemotes prices real
// sources with — just fed synthetic distances instead of a scouted/live source.
//
// Always priced RESERVED (10/tick): this table scores POTENTIAL for a room no colony has claimed yet, not
// a live colony's current reservation state.
//
// Best/worst case brackets the one unknown a scout hasn't resolved yet — where within the room a source
// actually sits relative to the entrance — not reservation (fixed) or claimer cost (fixed, see below):
//   best:  both sources ~26 tiles from the entrance (close to the border)
//   worst: both sources ~76 tiles from the entrance (deep in a 50-tile room, far corner)
// avg is the mean of the two. Claimer upkeep is the flat 2xCLAIM+MOVE floor from defaultEconomyContext,
// NOT distance-scaled — reservation upkeep does scale with distance in reality, but that's deliberately
// left out for this pass (see project memory) to keep the table a pure function of (sourceCount, hops).
//
// Cut off at MAX_REMOTE_HOPS (3): a 1-source room's avg already goes negative between hop 3 and 4, so
// nothing past this range is ever worth scoring — matches pickRemotes' own hard hop ceiling.

import { ROOM_CROSSING_TILES } from "./distance";
import { MAX_REMOTE_HOPS } from "./pickRemotes";
import { amortizeClaimer, defaultEconomyContext, netEnergy } from "./remoteEconomics";

const TRAVEL_BEST_INROOM = 26; // tiles: both sources near the entrance
const TRAVEL_WORST_INROOM = 76; // tiles: both sources deep in a 50-tile room

function avgRoomNet(sourceCount: number, hops: number): number {
  const ctx = defaultEconomyContext();
  const travelBest = hops * ROOM_CROSSING_TILES + TRAVEL_BEST_INROOM;
  const travelWorst = hops * ROOM_CROSSING_TILES + TRAVEL_WORST_INROOM;
  const perSource = (distance: number) => netEnergy({ distance, reserved: true }, ctx);
  const claimerUpkeep = amortizeClaimer(ctx.claimerBodyCost);
  const best = sourceCount * perSource(travelBest) - claimerUpkeep;
  const worst = sourceCount * perSource(travelWorst) - claimerUpkeep;
  return (best + worst) / 2;
}

// [sourceCount][hops] -> avg net energy/tick. sourceCount 1..2 (a "normal" room never has more than 2);
// hops 0..MAX_REMOTE_HOPS. Computed once at module load from game constants — no Game.*, no live data.
export const REMOTE_POTENTIAL_TABLE: readonly (readonly number[])[] = [
  [], // index 0 (no sources) unused — kept so sourceCount indexes the array directly
  Array.from({ length: MAX_REMOTE_HOPS + 1 }, (_, hops) => avgRoomNet(1, hops)),
  Array.from({ length: MAX_REMOTE_HOPS + 1 }, (_, hops) => avgRoomNet(2, hops))
];

/** Avg net energy/tick for a neighbor room with `sourceCount` sources at `hops` away from a candidate
 * anchor. 0 for anything outside the table's range (0 sources, >2 sources, or past MAX_REMOTE_HOPS) —
 * such a room contributes nothing to a candidate's remote-mining potential score. */
export function remotePotential(sourceCount: number, hops: number): number {
  if (hops < 0 || hops > MAX_REMOTE_HOPS) return 0;
  return REMOTE_POTENTIAL_TABLE[sourceCount]?.[hops] ?? 0;
}
