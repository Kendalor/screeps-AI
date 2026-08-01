// Precomputed avg net energy/tick a colonization candidate's neighboring KEEPER room is worth, purely as
// a function of hop distance — the keeper-room counterpart to remotePotentialTable.ts. A keeper room
// always has exactly 3 sources (see roomName.ts's keeper-band classification) and never needs a
// claimer/reservation, so unlike the normal-room table there's only one row, not one per source count.
//
// Four ways a keeper room's economics genuinely differ from a normal remote room's (see conversation with
// the user that set these):
//   1. Each source yields SOURCE_ENERGY_KEEPER_CAPACITY/ENERGY_REGEN_TIME = 4000/300 ~= 13.33/tick, not
//      the reserved-room rate of 10/tick — always, since there's no reservation state to vary. All 3
//      sources together cap at 40/tick.
//   2. The miner must be sized to actually reach that rate: HARVEST_POWER=2/WORK/tick means the normal
//      remote miner's 6 WORK (SOURCE_SATURATING_WORK, 12/tick cap) falls short of a keeper source's
//      13.33/tick — a real shortfall, not a simplification, since 12 < 13.33. This table instead uses a
//      7-WORK keeper miner (14/tick cap, just past the source's regen), priced separately from
//      defaultEconomyContext's 6-WORK default.
//   3. No claimer: keeper rooms cannot be reserved at all, so the flat claimer-upkeep deduction that
//      normal-room scoring subtracts (amortizeClaimer) simply doesn't apply here.
//   4. A keeper NPC guards each source/the mineral and must be killed to mine safely. Ramparts cannot
//      substitute or help here — they're only buildable in a room the player owns, and a keeper room is
//      never claimed, so the killer creep is the room's ONLY defense, not one layer of several. Its own
//      combat stats/uptime aren't modeled (no reliable authoritative numbers were available) — instead,
//      per the user's direction, the room is priced as needing one permanently-maintained killer creep,
//      costed flat like a claimer: the community-standard solo keeper-killer body (5 TOUGH, 10
//      RANGED_ATTACK, 5 HEAL, 20 MOVE = 3800 energy, 40/50 parts), amortized over its life. No uptime
//      discount, no combat-outcome modeling — same simplification style as the claimer floor, not a claim
//      that this body is guaranteed sufficient.
//
// Transport upkeep is priced the same way remotePotentialTable.ts prices it for a normal room — netEnergy's
// haulUpkeep sizes CARRY parts off whatever gross yield it's given, so feeding it the keeper rate (13.33/tick
// vs the usual 10/tick) already scales the hauled volume correctly; this is the same continuous-CARRY
// estimate (not load.ts's whole-hauler-body rounding) the normal-room table already uses as its cheap
// ranking approximation, not a keeper-specific gap.
//
// Miners AND structures are both correctly charged per-source, 3x (KEEPER_SOURCE_COUNT * perSource(...)) —
// netEnergy deducts one miner's upkeep and one roadContainerUpkeep(distance) per call, so 3 separate
// sources get 3 separate miners and 3 separate containers, as they must. The one known overstatement: each
// of those 3 calls also prices roadContainerUpkeep's road term as if that source has its own full-length
// private road back to the anchor, when in reality 3 same-room sources would share most of that road and
// only fork near the end — the same simplification netEnergy already applies to a normal room's 1-2
// sources, just proportionally larger here since there are more sources sharing one entrance. Left as-is
// deliberately (see conversation) to stay consistent with how every other room is priced, rather than
// giving keeper rooms a bespoke shared-road model — the error is conservative (understates a keeper room's
// value, doesn't inflate it).
//
// Mineral access (the third criterion from the user's colonization requirements) is NOT priced here —
// minerals have no energy/tick value in this codebase's economics (no market/lab-reaction model exists
// yet); a keeper room's mineral is a separate, non-arithmetic criterion for the picker to weigh directly
// off ScoutInfo.mineral, same as a normal room's.
//
// Best/worst/avg and the MAX_REMOTE_HOPS cutoff follow remotePotentialTable.ts exactly — see its header
// for why (in-room source placement is the unknown being bracketed, hop range matches pickRemotes' ceiling).

import { ROOM_CROSSING_TILES } from "./distance";
import { MAX_REMOTE_HOPS } from "./pickRemotes";
import { netEnergy, type EconomyContext } from "./remoteEconomics";

const TRAVEL_BEST_INROOM = 26; // tiles: all 3 sources near the entrance
const TRAVEL_WORST_INROOM = 76; // tiles: all 3 sources deep in a 50-tile room

const KEEPER_SOURCE_COUNT = 3; // every keeper room has exactly this many sources
const KEEPER_SOURCE_GROSS = SOURCE_ENERGY_KEEPER_CAPACITY / ENERGY_REGEN_TIME; // ~13.33/tick, always

// 7 WORK: the smallest body that actually saturates a keeper source (7*HARVEST_POWER=14 >= 13.33/tick) —
// the normal remote miner's 6 WORK (12/tick) falls short. 1 CARRY + 3 MOVE kept the same as the normal
// remote miner (behaviors/roles/miner.ts) since neither of those depends on the source's regen rate.
const KEEPER_MINER_WORK = 7;

// EconomyContext.claimerBodyCost is unused here (a keeper room has no claimer) but the field is required
// by netEnergy's signature — 0 rather than the normal claimer cost, so nothing accidentally deducts it.
function keeperEconomyContext(): EconomyContext {
  const minerBodyCost = KEEPER_MINER_WORK * BODYPART_COST[WORK] + BODYPART_COST[CARRY] + 3 * BODYPART_COST[MOVE];
  return { minerBodyCost, claimerBodyCost: 0 };
}

// Solo keeper-killer reference body (community-standard kiting setup: rangedAttack+heal outpaces the
// keeper's melee). Priced as a flat maintained-creep cost, not a combat-outcome model — see module header.
const KILLER_BODY_COST =
  5 * BODYPART_COST[TOUGH] + 10 * BODYPART_COST[RANGED_ATTACK] + 5 * BODYPART_COST[HEAL] + 20 * BODYPART_COST[MOVE];

function killerUpkeep(): number {
  return KILLER_BODY_COST / CREEP_LIFE_TIME;
}

function avgKeeperRoomNet(hops: number): number {
  const ctx = keeperEconomyContext();
  const travelBest = hops * ROOM_CROSSING_TILES + TRAVEL_BEST_INROOM;
  const travelWorst = hops * ROOM_CROSSING_TILES + TRAVEL_WORST_INROOM;
  const perSource = (distance: number) => netEnergy({ distance, reserved: false }, ctx, KEEPER_SOURCE_GROSS);
  const best = KEEPER_SOURCE_COUNT * perSource(travelBest) - killerUpkeep();
  const worst = KEEPER_SOURCE_COUNT * perSource(travelWorst) - killerUpkeep();
  return (best + worst) / 2;
}

// [hops] -> avg net energy/tick for a keeper room's full 3-source yield. Computed once at module load from
// game constants — no Game.*, no live data.
export const KEEPER_POTENTIAL_TABLE: readonly number[] = Array.from({ length: MAX_REMOTE_HOPS + 1 }, (_, hops) =>
  avgKeeperRoomNet(hops)
);

/** Avg net energy/tick for a keeper room at `hops` away from a candidate anchor. 0 past MAX_REMOTE_HOPS —
 * such a room contributes nothing to a candidate's remote-mining potential score. */
export function keeperPotential(hops: number): number {
  if (hops < 0 || hops > MAX_REMOTE_HOPS) return 0;
  return KEEPER_POTENTIAL_TABLE[hops] ?? 0;
}
