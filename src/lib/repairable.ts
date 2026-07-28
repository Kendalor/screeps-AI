// Shared "is this structure worth repairing" definition — the repair creep role, tower repair, and
// the idle-builder-to-repairer conversion must all agree on what counts, or they'd silently drift.

// Structure types worth keeping alive. Walls and ramparts are deliberately excluded: their hitsMax
// is enormous and topping them is a defense concern, not the decay upkeep this list covers. Roads and
// containers decay on a timer; the rest can take combat/misc damage.
export const REPAIRABLE: StructureConstant[] = [
  STRUCTURE_ROAD,
  STRUCTURE_CONTAINER,
  STRUCTURE_SPAWN,
  STRUCTURE_EXTENSION,
  STRUCTURE_TOWER,
  STRUCTURE_STORAGE,
  STRUCTURE_LINK
];

// Start repairing a structure once it has decayed past this fraction of hitsMax, mirroring legacy's 0.8
// threshold — chasing every last point of decay would smear effort and never let the repairer do anything else.
export const REPAIR_BELOW = 0.8;

export function needsRepair(type: StructureConstant, hits: number, hitsMax: number): boolean {
  return hitsMax > 0 && REPAIRABLE.includes(type) && hits < hitsMax * REPAIR_BELOW;
}
