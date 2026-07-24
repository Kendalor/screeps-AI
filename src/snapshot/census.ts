// Groups creeps by memory.home, never by current room — a visiting creep still belongs to its home colony.

import type { SnapCreep } from "./types";

export function censusByColony(creeps: SnapCreep[]): Record<string, SnapCreep[]> {
  const byColony: Record<string, SnapCreep[]> = {};
  for (const c of creeps) {
    (byColony[c.home] ??= []).push(c);
  }
  return byColony;
}
