// Shared shape every role class overrides: its spawn priority, its step loop, and its body
// calculator, grouped together so a role is understood by reading one file.
//
// Priority is absolute across the empire (higher wins), and each subclass's override is one point
// on that scale — economy high, growth low, with deliberate gaps so a future role slots in without
// renumbering. Builder outranks upgrader: construction unlocks capacity (an extension lets every
// future creep be bigger) so it compounds, while upgrading is a pure sink — measured, with
// upgraders ahead and uncapped they ate every drop and two builders finished *zero* extensions in
// 1500 ticks, freezing the room at 300 energy capacity. The miner/hauler economy still leads both:
// nothing to build or upgrade without energy in hand.

import type { BodyContext, Step } from "../types";

export abstract class Role {
  static readonly priority: number = 50; // mid-table default; every concrete role overrides
  static readonly steps: Step[] = [];
  static body(_energy: number, _ctx: BodyContext): BodyPartConstant[] {
    return [];
  }
}
