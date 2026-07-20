// Construction: what to build, and who builds it.
//
//   - `planBuilding` — site placement from the bunker goal layout, tier 3
//     (docs/rewrite-skeleton.md §9 P2, issue #16).
//   - `desiredBuilderCount` — the builder quota consumed by systems/spawning.ts
//     (issue #18, ported from BuildOperation).
//
// Both are pure: they read the snapshot (anchor/structures/sites/progress are
// resolved by snapshot/colony.ts, the sole impure boundary) and return plain
// data — never touching Game.* or Memory.

import GOAL_JSON from "../layouts/Base_2.json";
import type { Intent } from "../intents/types";
import { buildableAtRcl } from "../layouts/goal";
import type { PlacedStructure } from "../layouts/stamp";
import { stampLayout } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import { range } from "../lib/geometry";
import type { ColonySnapshot, EmpireSnapshot, SnapStructure } from "../snapshot/types";

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

// One builder per 5k of outstanding work, never more than 4 — a full bunker
// rollout is tens of thousands of progress, and an uncapped quota would starve
// every other role of spawn capacity.
const PROGRESS_PER_BUILDER = 5_000;
const MAX_BUILDERS = 4;
// Ported from BuildOperation.run: storage must clear this reserve *plus* the
// energy the outstanding sites will consume before dedicated builders are
// affordable — construction never eats the colony's emergency buffer.
const STORAGE_RESERVE = 50_000;

export function desiredBuilderCount(colony: ColonySnapshot): number {
  if (colony.constructionProgress <= 0) return 0;
  // No storage means no dedicated builders at all: pre-storage the bootstrap
  // role already builds (its step loop wraps through `build`) with a
  // near-identical body, so a builder here would only double-staff
  // construction while spawn capacity is tightest. Once storage exists it must
  // still cover the reserve plus the whole outstanding backlog.
  if (colony.storageEnergy <= 0) return 0;
  if (colony.storageEnergy < STORAGE_RESERVE + colony.constructionProgress) return 0;
  return Math.min(MAX_BUILDERS, Math.ceil(colony.constructionProgress / PROGRESS_PER_BUILDER));
}

export function planBuilding(snap: EmpireSnapshot): Intent[] {
  const out: Intent[] = [];
  for (const colony of snap.colonies) {
    if (!colony.anchor) continue;
    out.push(...planColony(colony));
  }
  return out;
}

function planColony(colony: ColonySnapshot): Intent[] {
  const anchor = colony.anchor!;
  // Full RCL8 goal (not just this RCL's buildable subset): a structure from a
  // higher tier that's already built (e.g. after a downgrade) is not stale.
  const goalAtAnchor = stampLayout(GOAL.placements, anchor);
  const buildable = gateRoads(stampLayout(buildableAtRcl(GOAL, colony.controllerLevel), anchor), colony);

  let budget = MAX_CONSTRUCTION_SITES - colony.sites.length;
  const out: Intent[] = [];
  for (const placement of buildable) {
    if (budget <= 0) break;
    const exists = colony.structures.some(sameSpot(placement)) || colony.sites.some(sameSpot(placement));
    if (exists) continue;
    out.push({ kind: "placeSite", room: colony.name, x: placement.x, y: placement.y, type: placement.type });
    budget--;
  }

  // Stale-structure teardown (issue #16): present in the room but not part of
  // the goal layout at all. Spawns are never auto-demolished — losing the only
  // spawn mid-migration is colony-fatal, so that's a separate, explicitly-gated step.
  for (const structure of colony.structures) {
    if (structure.type === "spawn") continue;
    if (goalAtAnchor.some(sameSpot(structure))) continue;
    out.push({ kind: "removeStructure", room: colony.name, x: structure.x, y: structure.y, type: structure.type });
  }

  return out;
}

// "Roads only where needed" (issue #16): CONTROLLER_STRUCTURES.road is 2500 at
// every RCL, so buildableAtRcl permits the full bunker road grid from RCL2 —
// that's "permitted", not "wanted". Only keep a road placement that neighbours
// a non-road structure already present or being placed this RCL, so the road
// network grows alongside the structures it actually serves.
function gateRoads(buildable: PlacedStructure[], colony: ColonySnapshot): PlacedStructure[] {
  const servedTiles = [
    ...colony.structures.filter(s => s.type !== ROAD),
    ...buildable.filter(s => s.type !== ROAD)
  ];
  return buildable.filter(p => p.type !== ROAD || servedTiles.some(s => range(p, s) === 1));
}

function sameSpot(a: PlacedStructure) {
  return (b: SnapStructure) => a.x === b.x && a.y === b.y && a.type === b.type;
}
