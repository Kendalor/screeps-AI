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

import type { GoalLayout, GoalPlacement } from "./sync";

export function buildableAtRcl(goal: GoalLayout, rcl: number): GoalPlacement[] {
  const byType = new Map<string, GoalPlacement[]>();
  for (const p of goal.placements) {
    (byType.get(p.type) ?? byType.set(p.type, []).get(p.type)!).push(p);
  }

  const out: GoalPlacement[] = [];
  for (const [type, placements] of byType) {
    const cap = CONTROLLER_STRUCTURES[type as BuildableStructureConstant]?.[rcl] ?? 0;
    if (cap <= 0) continue;
    const kept = [...placements].sort((a, b) => a.order - b.order).slice(0, cap);
    out.push(...kept);
  }
  return out.sort((a, b) => a.order - b.order);
}
