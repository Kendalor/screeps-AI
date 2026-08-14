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

// The Drain Energy operation's (issue #34/ADR 0006) squad healer: keeps the squad's members (and itself —
// squad membership includes self, see targets.ts's find:"squadMate") topped up via the heal verb.
//
// This step table is used ONLY while the creep is NOT currently squadded (ADR 0007): before the squad has
// assembled, while a freshly-spawned replacement is still walking toward the squad, or after the operation
// dissolves. Once squadded, movement AND action are dictated by the Squad entity (empire/creeps.ts's
// runSquads calls planSquadMove/planSquadActions), never this step table. That removes the old
// moveToPos/heal race entirely — heal can no longer steal primary-step status from movement, because
// squadded movement doesn't go through the step table at all — so Step.standStill (which existed purely to
// referee that race) is gone. moveToPos heads for drainRallyPos, a concrete TILE Drain recomputes every
// tick (the squad's live anchor once one exists, else the staging room center) — NOT moveToRoom/
// attackTargetRoom: healers converging on each other's ROOM (not a real destination) chased each other back
// and forth across a border forever once each landed on heal (confirmed live). heal (now always travelling
// toward its own resolved target too — see interpreter.ts's healStep) acts on the most damaged squad-mate.
export class DrainHealer extends Role {
  static override readonly priority = 94; // same table as DrainAttacker — below supply(101)/transport(100)/miner(95): colony economy comes first, an offensive squad is expendable
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return drainHealerBody(energy);
  }
  static override readonly steps: Step[] = [
    { do: "moveToPos", to: "drainRallyPos" },
    { do: "heal", at: { find: "squadMate", prefer: "mostDamaged" } }
  ];
}
