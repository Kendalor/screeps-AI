// Pure combat-math formulas shared by every place that needs to know what a tower, healer, or ranged
// attacker actually deals/receives at a given range — Defense's tower targeting and the fighter role's
// engagement logic each need the same falloff curves, and duplicating them risked silent drift (see
// repairable.ts for the same "shared definition" rationale). Every constant here mirrors a game GAME_*/
// TOWER_*/RANGED_*/HEAL_* value that has no ambient runtime export outside a live game tick, so each is
// hand-mirrored rather than imported.

import { range, type XY } from "./geometry";

// --- Boost multipliers ------------------------------------------------------------------------------
//
// Mirrors the game's BOOSTS table (no ambient runtime export outside a live game tick, same rationale
// as the header note above) — verified against the private-server engine source
// (node_modules/@screeps/engine/src/processor/intents/creeps/tick.js and
// node_modules/@screeps/common/lib/constants.js), not guessed. Each tier is the *tool*'s (attack/
// rangedAttack/heal) or *reduction*'s (tough's `damage`) multiplier for one boosted part of that type.
export const ATTACK_BOOST_MULTIPLIER: Partial<Record<string, number>> = {
  [RESOURCE_UTRIUM_HYDRIDE]: 2,
  [RESOURCE_UTRIUM_ACID]: 3,
  [RESOURCE_CATALYZED_UTRIUM_ACID]: 4
};

export const RANGED_ATTACK_BOOST_MULTIPLIER: Partial<Record<string, number>> = {
  [RESOURCE_KEANIUM_OXIDE]: 2,
  [RESOURCE_KEANIUM_ALKALIDE]: 3,
  [RESOURCE_CATALYZED_KEANIUM_ALKALIDE]: 4
};

// Heal-boost multipliers, tier 1-3 (LO/LHO2/XLHO2) — shared by SnapUnit.healParts (colony.ts) so both
// heal-output accounting and the incomingHeal math below agree on the same table.
export const HEAL_BOOST_MULTIPLIER: Partial<Record<string, number>> = {
  [RESOURCE_LEMERGIUM_OXIDE]: 2,
  [RESOURCE_LEMERGIUM_ALKALIDE]: 3,
  [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: 4
};

// TOUGH's boost multiplies *damage taken*, not damage dealt — 0.7/0.5/0.3 means a boosted TOUGH part
// only takes 70%/50%/30% of the raw damage a hit would otherwise deal. Unboosted TOUGH (and every other
// body part) takes damage at the unreduced 1x rate.
export const TOUGH_BOOST_MULTIPLIER: Partial<Record<string, number>> = {
  [RESOURCE_GHODIUM_OXIDE]: 0.7,
  [RESOURCE_GHODIUM_ALKALIDE]: 0.5,
  [RESOURCE_CATALYZED_GHODIUM_ALKALIDE]: 0.3
};

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

/** Raw damage a target actually takes after its TOUGH boost's damage reduction — a flat blended ratio
 * (see SnapUnit.toughReduction for how it's derived from the body), not the engine's exact per-part
 * hit-pool walk. 1 (no reduction) when the target has no boosted TOUGH. */
export function effectiveIncomingDamage(rawDamage: number, toughReduction: number): number {
  return rawDamage * toughReduction;
}

// --- Melee attack -------------------------------------------------------------------------------------

export const ATTACK_POWER = 30;

/** Damage a body's live ATTACK parts deal in melee, boost-weighted (see SnapUnit.attackParts for what
 * "boost-weighted" means) — melee has no range falloff, unlike towers/ranged attack. */
export function meleeAttackDamage(attackParts: number): number {
  return attackParts * ATTACK_POWER;
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
export const RANGED_ATTACK_POWER = 10;

/** Single-target rangedAttack damage a body's live RANGED_ATTACK parts deal — flat per part at any
 * range inside RANGED_ATTACK_RANGE (unlike rangedMassAttack below, single-target ranged has no falloff),
 * boost-weighted (see SnapUnit.rangedAttackParts). 0 beyond range. */
export function rangedAttackDamage(rangedAttackParts: number, dist: number): number {
  if (dist > RANGED_ATTACK_RANGE) return 0;
  return rangedAttackParts * RANGED_ATTACK_POWER;
}

// rangedMassAttack's damage per RANGED_ATTACK part, keyed by range (engine-hardcoded, not exposed as a
// JS constant): full rangedAttack power (10) at range 1, falling off to 4 and 1 at range 2 and 3, zero
// beyond — steep enough that mass attack only wins over a single-target rangedAttack (flat 10/part
// anywhere inside range 3) with several hostiles clustered close.
const MASS_ATTACK_DAMAGE_PER_PART: Record<number, number> = { 1: 10, 2: 4, 3: 1 };

/** Per-RANGED_ATTACK-part rangedMassAttack damage at a given range, 0 beyond RANGED_ATTACK_RANGE. */
export function massAttackDamagePerPartAt(dist: number): number {
  return MASS_ATTACK_DAMAGE_PER_PART[dist] ?? 0;
}

// --- Effective HP ---------------------------------------------------------------------------------

/** A target's real HP against incoming damage, once boosted TOUGH's reduction is priced in — e.g. 100
 * raw hits behind a 0.5 toughReduction survive like 200 hits would unboosted. Not the creep's actual
 * hits (that's still just SnapUnit.hits); this is "how much raw damage it takes to kill it", the number
 * that matters when comparing a target against an attacker's damage-per-tick. */
export function effectiveHp(hits: number, toughReduction: number): number {
  return toughReduction > 0 ? hits / toughReduction : Infinity;
}
