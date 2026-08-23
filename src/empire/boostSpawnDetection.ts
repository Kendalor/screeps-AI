import type { ColonySnapshot, SnapCreep } from "../snapshot/types";

// Pure predicate (gh #70, part of the #61 boosting epic): which of this colony's creeps are
// CURRENTLY spawning (SnapCreep.spawning) with an outstanding boost order (memory.boosts, gh #63)
// still pending. This is the urgent-lab-stocking trigger — moving compound from storage/terminal
// into a specific boost lab before the creep pops — distinct from #69's earlier census-presence
// trigger (which fires before the creep even starts spawning). Reads only ColonySnapshot, never a
// live Colony/Game.creeps reach, per every other operation in this codebase (see
// operations/operation.ts's header).
export function spawningBoostedCreeps(colony: ColonySnapshot): SnapCreep[] {
  return colony.creeps.filter(c => c.spawning && (c.memory.boosts?.length ?? 0) > 0);
}
