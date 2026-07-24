// Shared shape every role overrides: spawn priority, step loop, body calculator. Priority is absolute
// across the empire (higher wins); builder outranks upgrader since uncapped upgraders starved building.

import type { BodyContext, Step } from "../types";

export abstract class Role {
  static readonly priority: number = 50; // mid-table default; every concrete role overrides
  static readonly steps: Step[] = [];
  static body(_energy: number, _ctx: BodyContext): BodyPartConstant[] {
    return [];
  }
}
