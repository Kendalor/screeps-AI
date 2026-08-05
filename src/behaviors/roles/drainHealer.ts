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
// via the heal verb. moveToPos alone carries the healer everywhere — home to staging, staging to the
// advancing formation slot, and back on retreat — because drain.ts's intents() now sets squadTargetPos
// EVERY tick this operation runs, for every squad member unconditionally (a staging rally point while
// assembling, a formation offset once underway), never leaving it stale. This used to be a two-step
// moveToRoom+moveToPos handoff, but moveToRoom only ever pointed at the staging room and fell through
// (acted:false) the instant a healer arrived there OR whenever attackTargetRoom was momentarily unset
// (e.g. the first tick after spawning, before drain.ts's intents() had run) — either way the step cursor
// latched onto moveToPos and, since moveToRoom/moveToPos/heal are all "move"-kind steps that never
// self-complete (see interpreter.ts's isComplete), nothing ever sent it back. A healer that fell through
// on that spawn-time gap stood frozen at home forever, chasing a squadTargetPos left over from that one
// tick, even after attackTargetRoom was later populated correctly — confirmed live on shard0
// (2026-08-05). A single step whose target is always fresh can't go stale the same way: there's no
// earlier step to skip past, and moveToPos's own travelTo crosses room borders on its own already.
// Listed before heal so the same "acted:false on arrival falls through same-tick to the next step"
// mechanism lets a healer already in position still heal every tick, not just once every step cycle —
// while still out of position, heal fires as the co-fired bonus step (in range only, no travel — see
// empire/creeps.ts's coFireBonusStep) so it never stops healing just because it's mid-repositioning.
// heal's own standStill:true (Step's flag) is load-bearing, not decorative: heal is ALSO a "move"-kind
// step (see interpreter.ts's isComplete — it never self-completes except via targetGone) and its target
// (mostDamaged squadmate) is computed independently of squadTargetPos. Without standStill, the one tick
// moveToPos's exact-tile-equality "arrived" check happens to be satisfied, the loop falls through
// same-tick into heal, which resolves a target and travels toward IT — grabbing primary-step status
// permanently, since nothing ever routes the cursor back to moveToPos afterward. Confirmed live on
// shard0 (2026-08-05): two healers froze mid-formation, walking toward whichever squadmate `heal` had
// picked instead of their assigned 2x2 slot, forever after that one coincidental tick. standStill keeps
// heal action-only in every context (primary or bonus) — formation position is exclusively moveToPos's job.
export class DrainHealer extends Role {
  static override readonly priority = 110; // same table as DrainAttacker — a squad's healers are exactly as urgent as its striker
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return drainHealerBody(energy);
  }
  static override readonly steps: Step[] = [
    { do: "moveToPos", to: "squadTargetPos" },
    { do: "heal", at: { find: "squadMate", prefer: "mostDamaged" }, standStill: true }
  ];
}
