// Pure combat-math formulas shared by every place that needs to know what a tower, healer, or ranged
// attacker actually deals/receives at a given range — Defense's tower targeting and the fighter role's
// engagement logic each need the same falloff curves, and duplicating them risked silent drift (see
// repairable.ts for the same "shared definition" rationale). Every constant here mirrors a game GAME_*/
// TOWER_*/RANGED_*/HEAL_* value that has no ambient runtime export outside a live game tick, so each is
// hand-mirrored rather than imported.

import { range, type XY } from "./geometry";

// --- Tower damage -----------------------------------------------------------------------------------

const TOWER_OPTIMAL_RANGE = 5;
const TOWER_FALLOFF_RANGE = 20;
const TOWER_POWER_ATTACK = 600;
const TOWER_FALLOFF = 0.75;

/** Screeps' tower damage formula: full power out to TOWER_OPTIMAL_RANGE, linear falloff to
 * TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF) by TOWER_FALLOFF_RANGE, flat beyond that. */
export function towerDamageAt(dist: number): number {
  if (dist <= TOWER_OPTIMAL_RANGE) return TOWER_POWER_ATTACK;
  if (dist >= TOWER_FALLOFF_RANGE) return TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF);
  const falloffFraction = (dist - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);
  return TOWER_POWER_ATTACK * (1 - TOWER_FALLOFF * falloffFraction);
}

// --- Healing ------------------------------------------------------------------------------------------

const HEAL_POWER = 12;
const RANGED_HEAL_POWER = 4;

// Ranged heal reaches range 3 (melee heal only range 1); shared by incomingHeal's range gate below and
// by any caller that needs to know how far a heal-assist can reach.
export const HEAL_ASSIST_RANGE = 3;

/** Mirrors HEAL_POWER/RANGED_HEAL_POWER — melee heal (range <= 1) is 3x stronger than ranged heal
 * (range 2-3), zero beyond that. */
export function healRateAt(dist: number): number {
  if (dist <= 1) return HEAL_POWER;
  if (dist <= HEAL_ASSIST_RANGE) return RANGED_HEAL_POWER;
  return 0;
}

// Minimal shape incomingHeal needs — a position plus boost-weighted HEAL part count (see
// SnapUnit.healParts for what "boost-weighted" means), so callers aren't forced into the full SnapUnit.
export interface HealSource extends XY {
  healParts: number;
}

/** Total heal a position can receive this tick from every heal source within range (a target healing
 * itself is just another entry at range 0) — the real in-game ceiling incoming damage has to beat. Each
 * source contributes at its own range-appropriate rate, not a flat one. */
export function incomingHeal(target: XY, sources: readonly HealSource[]): number {
  return sources.reduce((sum, s) => sum + s.healParts * healRateAt(range(target, s)), 0);
}

// --- Ranged attack / mass attack -----------------------------------------------------------------------

export const RANGED_ATTACK_RANGE = 3;

// rangedMassAttack's damage per RANGED_ATTACK part, keyed by range (engine-hardcoded, not exposed as a
// JS constant): full rangedAttack power (10) at range 1, falling off to 4 and 1 at range 2 and 3, zero
// beyond — steep enough that mass attack only wins over a single-target rangedAttack (flat 10/part
// anywhere inside range 3) with several hostiles clustered close.
const MASS_ATTACK_DAMAGE_PER_PART: Record<number, number> = { 1: 10, 2: 4, 3: 1 };

/** Per-RANGED_ATTACK-part rangedMassAttack damage at a given range, 0 beyond RANGED_ATTACK_RANGE. */
export function massAttackDamagePerPartAt(dist: number): number {
  return MASS_ATTACK_DAMAGE_PER_PART[dist] ?? 0;
}
