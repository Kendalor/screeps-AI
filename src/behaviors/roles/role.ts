// Shared shape every role overrides: spawn priority, step loop, body calculator. Priority is absolute
// across the empire (higher wins); builder outranks upgrader since uncapped upgraders starved building.

import type { BodyContext, Step } from "../types";

export abstract class Role {
  static readonly priority: number = 50; // mid-table default; every concrete role overrides
  static readonly steps: Step[] = [];
  // Opt in to opportunistic en-route pickup (behaviors/sweep.ts): while travelling to a gather target,
  // detour a tile or two to grab loose piles passed near. Only movers that gather energy want this.
  static readonly sweep: boolean = false;
  static body(_energy: number, _ctx: BodyContext): BodyPartConstant[] {
    return [];
  }
}
