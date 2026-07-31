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
  static body(_energy: number, _ctx: BodyContext): BodyPartConstant[] {
    return [];
  }
}
