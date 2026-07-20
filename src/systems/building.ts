// Construction-site placement from the bunker goal layout, tier 3
// (docs/rewrite-skeleton.md §9 P2, issue #16). Pure: reads the snapshot
// (anchor/structures/sites are resolved by snapshot/colony.ts, the sole
// impure boundary) and returns intents — never touches Game.* or Memory.

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
