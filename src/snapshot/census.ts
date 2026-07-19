// alive/spawning creep counts per role per colony (docs/rewrite-skeleton.md §1).
// Pure over a plain creep list so it is unit-tested without Game; the snapshot
// builder feeds it Game.creeps.

import type { Census } from "./types";
import type { RoleName } from "../memory/schema";

// The minimal creep facts the census needs — home colony and role. Spawning
// creeps count too (skeleton §4: "alive + currently spawning"), so a role at
// quota isn't spawned twice while its creep is still in the spawn.
export interface CensusCreep {
  home: string;
  role: RoleName;
  spawning: boolean;
}

export function censusByColony(creeps: CensusCreep[]): Record<string, Census> {
  const byColony: Record<string, Census> = {};
  for (const c of creeps) {
    const census = (byColony[c.home] ??= {});
    census[c.role] = (census[c.role] ?? 0) + 1;
  }
  return byColony;
}
