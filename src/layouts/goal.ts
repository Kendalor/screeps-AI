// Derives the buildable subset of a bunker goal at a given controller level.
// The goal JSON is the RCL8 end-state; a colony at RCL N may only build what
// CONTROLLER_STRUCTURES permits at that level. When a type's cap is below the
// goal's count, the lowest-`order` placements win (earliest in the pre-baked
// cluster-growth build order), so extensions fill as a tight growing blob.
//
// This is a pure "what the RCL cap permits" filter, nothing more. Roads have a
// cap of 2500 at every level, so the full bunker road network is "permitted"
// from RCL2 — gating roads to only those adjacent to structures that actually
// exist yet ("roads only where needed") is a placement policy for building.ts
// (issue #16), not part of this derivation.

import { range, type XY } from "../lib/geometry";
import type { GoalLayout, GoalPlacement } from "./sync";

// Re-grows the extension blob for one specific room, using the room's sources to
// decide which side of the blob to extend first.
//
// This deliberately re-runs the same greedy growth sync.ts bakes, rather than
// patching the baked `order` values with a bonus. Patching cannot work: `order`
// is a rank (extensions occupy slots 72..131 in Base_2) while a source bonus is
// a distance, so any constant that is large enough to redirect growth is also
// large enough to let a rim extension leap over the ones hugging storage.
//
// Growing instead keeps contiguity a HARD constraint — each pick must still be
// adjacent to the blob built so far — and spends the source direction only on
// the tiebreak between equally-contiguous candidates. That is exactly the
// degree of freedom the baked order left unspecified.
//
// Seeded from storage for the same reason sync.ts is: a filler's round trip is
// storage -> extension -> storage.
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

  // Source positions are absolute room coords; the goal is anchor-relative.
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
      // Contiguity first (hard), then tightness to the load point, and only then
      // source direction. Ordering the last two the other way round produces a
      // 1-wide tendril creeping at the sources: every step is contiguous and
      // strictly closer to the source, so growth never fills in sideways. Ranking
      // storage-distance first keeps the blob compact and spends the source
      // direction on the genuine ties — which of several equally-tight tiles to
      // take next.
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

  // Non-extensions keep their baked order; extensions are spliced back in the
  // freshly grown sequence, occupying the same set of order slots as before.
  const slots = exts.map(e => e.order).sort((a, b) => a - b);
  const reordered = new Map<GoalPlacement, number>();
  grown.forEach((e, i) => reordered.set(e, slots[i]));
  return [...placements].sort((a, b) => (reordered.get(a) ?? a.order) - (reordered.get(b) ?? b.order));
}

// Per-room context for the source bias. Omitted (or sourceless) means the baked
// order is used as-is — that is the pure, room-independent behaviour.
export interface RoomContext {
  anchor: XY;
  sources: XY[];
}

export function buildableAtRcl(goal: GoalLayout, rcl: number, room?: RoomContext): GoalPlacement[] {
  // Bias BEFORE capping, not after: the cap keeps the lowest-ranked N of each
  // type, so ranking has to happen while all 60 extensions are still candidates.
  // Biasing the already-capped set could only shuffle the same 5 extensions and
  // would never let a better-aimed one make the cut.
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
