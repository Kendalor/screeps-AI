// Shared shape every role overrides: spawn priority, step loop, body calculator. Priority is absolute
// across the empire (higher wins); builder outranks upgrader since uncapped upgraders starved building.

import type { BodyContext, Step } from "../types";

export abstract class Role {
  static readonly priority: number = 50; // mid-table default; every concrete role overrides
  static readonly steps: Step[] = [];
  // Opt in to opportunistic en-route pickup (behaviors/sweep.ts): while travelling to a gather target,
  // detour a tile or two to grab loose piles passed near. Only movers that gather energy want this.
  static readonly sweep: boolean = false;
  // Opt in to stepping off a road tile once settled in to build/repair/upgrade (behaviors/roadAvoidance.ts),
  // so the creep doesn't block travelling creeps for the whole job. Only roles that park in place while
  // working want this — movers (haulers, miners standing on their own container) don't need it.
  static readonly doNotBlockRoads: boolean = false;
  // Opt in as a road user (behaviors/roadAvoidance.ts): a role that spends its working life pathing
  // between rooms/targets rather than parking on one tile. Gates whether a parked worker bothers
  // stepping off a road at all — only set on roles that actually walk roads to do their job.
  static readonly mover: boolean = false;
  // Opt in to fleeing an armed hostile (behaviors/interpreter.ts's fleeThreat): a creep with no means to
  // fight back breaks off whatever it's doing and retreats once a hostile carrying ATTACK/RANGED_ATTACK
  // closes within FLEE_RADIUS, rather than working on obliviously. Only non-combat roles exposed to
  // remote/hostile rooms want this — a defender/attacker must never set it, or it'd flee the very hostile
  // it's meant to engage.
  static readonly flee: boolean = false;
  // Opt in to retreating once combat damage has stripped every part of this kind (behaviors/interpreter.ts's
  // retreatIfDisarmed): a role built around one specific body part (RANGED_ATTACK for Defender, ATTACK for
  // Attacker, WORK for Builder/Repair/Miner) can no longer do its job at all once that part count hits
  // zero — hits reduce a part's getActiveBodyparts count to 0 well before the creep itself dies, so a body
  // can easily outlive its own usefulness. Retreats toward a friendly HEAL creep if one is in the room,
  // else walks home and PARKS there — the home room's tower heals any damaged friendly creep standing in
  // it, so "go home and wait" passively restores hits with no squad healer required. Undefined (the
  // default) opts out entirely: only roles with one clear defining part want this — a hauler's CARRY
  // degrading doesn't make it useless the same all-or-nothing way, for instance.
  static readonly retreatPart?: BodyPartConstant;
  // Opt in to bypass the step-table dispatch entirely (empire/creeps.ts's dispatchCreep): "logistics"
  // routes Transport/Supply to their own self-registered pool's task runner (transportTaskRunner.ts's
  // runTransportTask / supplyTaskRunner.ts's runSupplyTask, as of gh #52/#53 — not a static step table),
  // "steward" routes to empire/creeps.ts's dispatchSteward (anchor travel, then
  // behaviors/stewardTaskRunner.ts's rate-ranked pool — gh #54, ADR 0008 — not a static step table).
  // Undefined (the default) runs the ordinary
  // step-table dispatch (runOne). Making this explicit means a role with a genuinely empty steps table
  // by mistake fails loudly (runOne's `steps.length === 0` early-return does nothing) instead of
  // silently behaving like a diverted role it never opted into.
  static readonly dispatch?: "logistics" | "steward";
  // Opt in to boosting (gh #61 epic): the abstract boost ACTIONS this role's body can ever benefit from,
  // e.g. Healer -> ["heal", "tough"]. Deliberately an action name (matching the engine's own
  // BOOSTS[bodyPart][compound] = { actionType: multiplier } shape), not a BodyPartConstant list — one part
  // (WORK) boosts differently depending on what it's doing (harvest vs. build vs. upgradeController vs.
  // dismantle vs. repair are different compounds on the same part), so a part alone is ambiguous about
  // which compound would even apply. This is the cheap, static half of the eventual boosting pre-emption
  // check (mirroring flee/retreatPart's split above): a role with no boostable actions can never be a boost
  // candidate at all, checked before ever looking at a specific creep's memory. Empty/undeclared (the
  // default) is correct for almost every role — only a handful of combat-adjacent roles (Healer today,
  // later Attacker/Defender/Drain roles) have a body worth spending compound on. See docs/boosting-plan.md
  // decision 4 for the full reasoning and decision 7 for how this pairs with CreepMemory.boosts at runtime
  // (not wired up yet — this ticket is schema-only).
  static readonly boostable: readonly string[] = [];
  static body(_energy: number, _ctx: BodyContext): BodyPartConstant[] {
    return [];
  }
}
