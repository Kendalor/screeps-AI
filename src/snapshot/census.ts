// Groups creeps by the colony they call home. Pure over a plain creep list so it is unit-tested
// without Game; the snapshot builder feeds it Game.creeps.
//
// Grouping is by memory.home, never by the room the creep stands in — a creep visiting a
// neighbouring room still belongs to its home colony, and keying by room would make miner counts
// flicker whenever one steps across a border.

import type { SnapCreep } from "./types";

export function censusByColony(creeps: SnapCreep[]): Record<string, SnapCreep[]> {
  const byColony: Record<string, SnapCreep[]> = {};
  for (const c of creeps) {
    (byColony[c.home] ??= []).push(c);
  }
  return byColony;
}
