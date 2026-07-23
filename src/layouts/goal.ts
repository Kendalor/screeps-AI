// Derives the buildable subset of the RCL8 bunker goal at a given controller level: when a type's
// cap is below the goal's count, the lowest-`order` placements win, so extensions fill as a tight
// growing blob. Pure "what the RCL cap permits" filter — placement policy (e.g. gating roads to
// only where needed) lives in building.ts.

import { range, type XY } from "../lib/geometry";
import type { GoalLayout, GoalPlacement } from "./sync";

// Re-grows the extension blob for one room, biased toward sources for the tiebreak. Re-runs the
// same greedy growth sync.ts bakes rather than patching `order` with a distance bonus — patching
// can't work since `order` is a rank, not a distance, so no constant redirects growth safely
// without letting a rim extension leap over ones hugging storage. Contiguity stays a hard
// constraint; the source direction only breaks ties between equally-contiguous candidates.
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
      // Contiguity first (hard), then tightness to storage, then source direction as tiebreak —
      // reversing the last two would produce a 1-wide tendril creeping toward the source instead.
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
 * The layout tiles an operation should treat as obstacles when pathing: what the colony is
 * committing to at this RCL, stamped into room coordinates.
 *
 * Deliberately **not** the full RCL8 goal. That goal is a solid 13x13 block of 132 structures
 * centred on the anchor, and `buildCostMatrix` marks every non-walkable type impassable — so
 * pathing outward from the anchor against the complete goal always fails, the anchor being sealed
 * in by its own plan. The buildable subset has gaps, grows as the bunker fills in, and is what the
 * colony will actually build.
 *
 * Shared by `building.ts` (which seeds the operation poll with it) and any operation that needs the
 * same baseline outside that poll, so the two can never path against different plans.
 */
export function plannedObstacles(goal: GoalLayout, rcl: number, anchor: XY, sources: XY[]): GoalPlacement[] {
  return buildableAtRcl(goal, rcl, { anchor, sources });
}

export function buildableAtRcl(goal: GoalLayout, rcl: number, room?: RoomContext): GoalPlacement[] {
  // Bias BEFORE capping: capping keeps the lowest-ranked N, so biasing after would only
  // shuffle the already-capped subset instead of letting a better-aimed extension make the cut.
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
