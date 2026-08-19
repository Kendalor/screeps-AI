import { Role } from "./role";

// A link's own capacity (800) is the largest single job the steward ever does — draining a full link in
// one go. Capping CARRY here rather than growing to the 50-part hard cap: a steward's per-trip carry
// past that point is dead capacity (nothing it does ever holds more), and every extra part only makes
// the one-time spawn slower and costlier for no benefit — unlike transport, there's no throughput case
// for a bigger body since travel time is zero either way.
const LINK_CAPACITY = 800;
const MAX_CARRY = LINK_CAPACITY / BODYPART_COST[CARRY]; // 16

// A single MOVE is enough: the steward parks permanently on the anchor tile (see empire/creeps.ts's
// dispatchSteward) and never fatigues once it arrives, since it stops moving — unlike transport/hauler,
// no 1:1 CARRY:MOVE is needed here. All remaining energy up to the cap goes to CARRY.
export function stewardBody(energy: number): BodyPartConstant[] {
  const affordable = Math.max(1, Math.floor((energy - BODYPART_COST[MOVE]) / BODYPART_COST[CARRY]));
  const carry = Math.min(MAX_CARRY, affordable);
  return [MOVE, ...new Array<BodyPartConstant>(carry).fill(CARRY)];
}

// Stationary anchor manager: sits on the tile between storage/terminal/link/spawn and balances energy
// between them (see behaviors/stewardTaskRunner.ts) — the legacy bot's "Logistic" role, reworked onto the
// new snapshot/intent architecture. As of gh #54, driven by stewardTaskRunner.ts's rate-ranked
// LogisticsRequest pool (ADR 0008), not a hand-tuned threshold cascade: all three of its targets are
// room-fixed and zero-travel from the anchor, so the only ranking distance that ever matters is
// buffer-detour-via-storage vs. direct. dispatch: "steward" routes it to empire/creeps.ts's dispatchSteward
// (anchor travel, then stewardTaskRunner.ts's runStewardTask) instead of the step-table dispatch (see
// Role.dispatch's doc, behaviors/roles/role.ts).
export class Steward extends Role {
  // Below transport(100)/miner(95)/drainHealer/drainAttacker/attacker(94): a spawn/extension/tower
  // deficit, a source going unmined, or an active offensive squad should all win a spawn slot over
  // rebalancing storage/terminal. Above every other economy role — once a steward is due for handoff
  // (see operations/logistics.ts's needsHandoff), it must not get bumped by a lower-value role or the
  // link triangle goes unrefereed for a gap.
  static override readonly priority = 93;
  static override readonly dispatch = "steward";
  static override body(energy: number): BodyPartConstant[] {
    return stewardBody(energy);
  }
}
