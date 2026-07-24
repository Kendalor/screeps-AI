// Derives the buildable subset of the RCL8 bunker goal at a given controller level: when a type's
// cap is below the goal's count, the lowest-`order` placements win, so extensions fill as a tight blob.

import { range, type XY } from "../lib/geometry";
import type { GoalLayout, GoalPlacement } from "./sync";

// Re-grows the extension blob for one room, biased toward sources as a tiebreak only; contiguity stays a hard constraint.
export function biasTowardSources(
  placements: GoalPlacement[],
  anchor: XY,
  sources: XY[]
): GoalPlacement[] {
  if (sources.length === 0) return placements;

  const exts = placements.filter(p => p.type === "extension");
  if (exts.length === 0) return placements;

  const storage = placements.find(p => p.type === "storage");
  const seed: XY = storage ?? { x: 0, y: 0 };

  // Sources are absolute room coords; the goal is anchor-relative.
  const relSources = sources.map(s => ({ x: s.x - anchor.x, y: s.y - anchor.y }));
  const toSource = (p: XY) => Math.min(...relSources.map(s => range(p, s)));

  const remaining = [...exts];
  const blob: XY[] = [seed];
  const grown: GoalPlacement[] = [];

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestKey: [number, number, number] = [Infinity, Infinity, Infinity];
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let nearest = Infinity;
      for (const b of blob) {
        const d = range(cand, b);
        if (d < nearest) nearest = d;
      }
      // Contiguity first (hard), then tightness to storage, then source direction as tiebreak.
      const key: [number, number, number] = [nearest, range(cand, seed), toSource(cand)];
      if (key[0] < bestKey[0] ||
          (key[0] === bestKey[0] && (key[1] < bestKey[1] ||
            (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
        bestKey = key;
        bestIdx = i;
      }
    }
    const [chosen] = remaining.splice(bestIdx, 1);
    blob.push(chosen);
    grown.push(chosen);
  }

  // Non-extensions keep their baked order; extensions are spliced back into the same order slots.
  const slots = exts.map(e => e.order).sort((a, b) => a - b);
  const reordered = new Map<GoalPlacement, number>();
  grown.forEach((e, i) => reordered.set(e, slots[i]));
  return [...placements].sort((a, b) => (reordered.get(a) ?? a.order) - (reordered.get(b) ?? b.order));
}

// Omitted (or sourceless) means the baked order is used as-is.
export interface RoomContext {
  anchor: XY;
  sources: XY[];
}

/**
 * Obstacle tiles for pathing: the buildable subset, not the full RCL8 goal (a solid 13x13 block
 * that would seal the anchor in against its own plan). Shared with building.ts so both path against the same plan.
 */
export function plannedObstacles(goal: GoalLayout, rcl: number, anchor: XY, sources: XY[]): GoalPlacement[] {
  return buildableAtRcl(goal, rcl, { anchor, sources });
}

export function buildableAtRcl(goal: GoalLayout, rcl: number, room?: RoomContext): GoalPlacement[] {
  // Bias BEFORE capping, so a better-aimed extension can still make the cut.
  const ranked = room ? biasTowardSources(goal.placements, room.anchor, room.sources) : goal.placements;
  const rank = new Map(ranked.map((p, i) => [p, i]));
  const byRank = (a: GoalPlacement, b: GoalPlacement) => rank.get(a)! - rank.get(b)!;

  const byType = new Map<string, GoalPlacement[]>();
  for (const p of goal.placements) {
    (byType.get(p.type) ?? byType.set(p.type, []).get(p.type)!).push(p);
  }

  const out: GoalPlacement[] = [];
  for (const [type, placements] of byType) {
    const cap = CONTROLLER_STRUCTURES[type as BuildableStructureConstant]?.[rcl] ?? 0;
    if (cap <= 0) continue;
    const kept = [...placements].sort(byRank).slice(0, cap);
    out.push(...kept);
  }
  return out.sort(byRank);
}
