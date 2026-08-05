import { bodyCost, parts } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// ADR 0006's 200+ effective-heal floor is a SQUAD total (3 healers together, see drain.ts's
// advanceIsSafe/incomingHeal, which sums every healer's output), not a per-healer minimum. 6 HEAL parts
// (72 effective, HEAL_POWER=12/part) times 3 healers = 216, clearing the floor with headroom — this is
// the fixed, non-scaling floor of every drain healer's body, 6 HEAL + 6 MOVE (1:1, full speed loaded).
// On top of that floor, TOUGH is added in fixed TOUGH:MOVE pairs (not scaled by energy) for a flat HP
// buffer: 4 pairs = 400 HP absorbed before a healer's own hits start dropping, sized to survive
// incidental splash/tower damage while in the range-1 formation, without diverting energy away from the
// fixed heal-output floor above. Both energy tiers are exact costs, not affordableSets-style scaling —
// there's nothing in between "can't afford the heal floor" and "can afford the floor plus full buffer".
const HEAL_FLOOR_SETS = 6; // 6 * HEAL_POWER(12) = 72/healer; x3 healers = 216 >= the 200 squad floor
const TOUGH_MOVE_PAIRS = 4; // 4 * TOUGH hits(100) = 400 HP buffer per healer

const DRAIN_HEALER_MIN_BODY: BodyPartConstant[] = [...parts(HEAL, HEAL_FLOOR_SETS), ...parts(MOVE, HEAL_FLOOR_SETS)];
const DRAIN_HEALER_MAX_BODY: BodyPartConstant[] = [
  ...parts(TOUGH, TOUGH_MOVE_PAIRS),
  ...DRAIN_HEALER_MIN_BODY,
  ...parts(MOVE, TOUGH_MOVE_PAIRS)
];

export const DRAIN_HEALER_MIN_COST = bodyCost(DRAIN_HEALER_MIN_BODY);
const DRAIN_HEALER_MAX_COST = bodyCost(DRAIN_HEALER_MAX_BODY);

function drainHealerBody(energy: number): BodyPartConstant[] {
  if (energy < DRAIN_HEALER_MIN_COST) return [];
  return energy >= DRAIN_HEALER_MAX_COST ? DRAIN_HEALER_MAX_BODY : DRAIN_HEALER_MIN_BODY;
}

// The Drain Energy operation's (issue #34/ADR 0006) squad healer: keeps the squad's melee attacker (and
// itself/other healers — squad membership includes self, see targets.ts's find:"squadMate") topped up
// via the heal verb. moveToPos closes onto the operation's per-tick formation tile (see
// operations/drain.ts's intents()) FIRST — heal's own target-chasing travelTo isn't enough on its own to
// hold the strict range-1-of-everyone 2x2 block ADR 0006 requires, only loose proximity. Listed before
// heal so the same "acted:false on arrival falls through same-tick to the next step" mechanism
// moveToRoom->attack already relies on lets a healer already in position still heal every tick, not just
// once every step cycle — while still out of position, heal fires as the co-fired bonus step (in range
// only, no travel — see empire/creeps.ts's coFireBonusStep) so it never stops healing just because it's
// mid-repositioning. No operation wiring here (out of scope for issue #35) — targeting the position
// itself is issue #37's job; this role is only the primitive step list + body.
export class DrainHealer extends Role {
  static override readonly priority = 110; // same table as DrainAttacker — a squad's healers are exactly as urgent as its striker
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return drainHealerBody(energy);
  }
  static override readonly steps: Step[] = [
    { do: "moveToPos", to: "squadTargetPos" },
    { do: "heal", at: { find: "squadMate", prefer: "mostDamaged" } }
  ];
}
