import { affordableSets, bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// HEAL:MOVE 1:1 — HEAL_POWER is 12/part at range 1 (lib/combat.ts's healRateAt); the drain squad's
// heal-output floor (ADR 0006/issue #35) is 200+ effective, so the minimum viable set count is
// ceil(200/12) = 17 (17 * 12 = 204). 1 MOVE per HEAL keeps it at full speed on plain terrain (screeps'
// road-free speed-1 ratio) even fully loaded, same ratio DrainAttacker/Attacker use. Capped at 25 sets —
// comfortably above the 200 floor while leaving spawn-affordability headroom (25 sets = 7500 energy,
// under an RCL8 room's 12900 extension cap) rather than maxing out every set the 50-body-part ceiling allows.
const DRAIN_HEALER_SET: BodyPartConstant[] = [HEAL, MOVE];
const MIN_DRAIN_HEALER_SETS = 17; // 17 * HEAL_POWER(12) = 204 >= the 200 effective-heal floor
const MAX_DRAIN_HEALER_SETS = 25;

export const DRAIN_HEALER_MIN_COST = bodyCost(DRAIN_HEALER_SET) * MIN_DRAIN_HEALER_SETS;

function drainHealerBody(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, DRAIN_HEALER_SET, MIN_DRAIN_HEALER_SETS, MAX_DRAIN_HEALER_SETS);
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) body.push(...DRAIN_HEALER_SET);
  return body;
}

// The Drain Energy operation's (issue #34/ADR 0006) squad healer: keeps the squad's melee attacker (and
// itself/other healers — squad membership includes self, see targets.ts's find:"squadMate") topped up
// via the new heal verb. No operation wiring here (out of scope for issue #35) — targeting/movement into
// the target room is issue #37's job; this role is only the primitive step list + body.
export class DrainHealer extends Role {
  static override readonly priority = 110; // same table as DrainAttacker — a squad's healers are exactly as urgent as its striker
  static override readonly mover = true;
  static override body(energy: number): BodyPartConstant[] {
    return drainHealerBody(energy);
  }
  static override readonly steps: Step[] = [{ do: "heal", at: { find: "squadMate", prefer: "mostDamaged" } }];
}
