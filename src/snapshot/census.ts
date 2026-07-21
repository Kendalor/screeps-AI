// Alive/spawning creep counts per role per colony. Pure over a plain creep list so it is
// unit-tested without Game; the snapshot builder feeds it Game.creeps.

import type { Census } from "./types";
import type { RoleName } from "../memory/schema";

// Spawning creeps count too, so a role at quota isn't spawned twice while its creep is still in the spawn.
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
