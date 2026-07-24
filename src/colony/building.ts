// The construction arbiter: merges every operation's structures() claims with the bunker layout,
// orders them, spends the focus-site budget, and tears down what no operation claims. Pure.

import { plannedObstacles, buildableAtRcl } from "../layouts/goal";
import GOAL_JSON from "../layouts/Base_2.json";
import { stampLayout, type PlacedStructure } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import { range } from "../lib/geometry";
import type { Intent } from "../intents/types";
import type { Operation } from "../operations";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

// Cap open sites low so a small pre-storage workforce finishes structures instead of smearing effort across the backlog.
const FOCUS_SITE_CAP = 2;
// Roads are dead weight while the bunker is still going up; hold until the colony can afford paving
// (RCL3 with all extensions built = 800 capacity). Mining's source-access roads are exempt — see wantedStructures.
export const ROADS_FROM_ENERGY_CAPACITY = 800;
// Most important first: tower (defense), extensions (capacity), containers, storage. Unlisted types sort at DEFAULT_PRIORITY; roads last.
const TYPE_PRIORITY: Partial<Record<BuildableStructureConstant, number>> = {
  tower: 0,
  extension: 1,
  container: 2,
  storage: 3
};
const DEFAULT_TYPE_PRIORITY = 10;
const ROAD_PRIORITY = 99;

function typePriority(type: BuildableStructureConstant): number {
  if (type === ROAD) return ROAD_PRIORITY;
  return TYPE_PRIORITY[type] ?? DEFAULT_TYPE_PRIORITY;
}

export function planBuilding(colony: ColonySnapshot, operations: Operation[]): Intent[] {
  if (!colony.anchor) return [];
  // Polled once and threaded through, so placement and demolition can't disagree about what was claimed this tick.
  return placeAndDemolish(colony, claimsOf(colony, operations));
}

// Gathered sequentially, not flatMap: each operation paths around the layout and around siblings' plans already claimed,
// so two operations heading for nearby targets share a road instead of laying two. operationsFor()'s order is load-bearing.
export function claimsOf(colony: ColonySnapshot, operations: Operation[]): PlacedStructure[] {
  // This level's buildable subset, not the full RCL8 goal — the full goal seals the anchor in, making it unpathable from itself.
  const planned: PlacedStructure[] = stampLayout(
    plannedObstacles(GOAL, colony.controllerLevel, colony.anchor!, colony.sources),
    colony.anchor!
  );
  const claimed: PlacedStructure[] = [];
  for (const op of operations) {
    const claim = op.structures(colony, planned);
    claimed.push(...claim);
    planned.push(...claim);
  }
  return claimed;
}

// Exported for integration benchmarks. `claimed` is already state-gated per operation, so this merges rather than re-gates.
export function wantedStructures(colony: ColonySnapshot, claimed: PlacedStructure[] = []): PlacedStructure[] {
  const anchor = colony.anchor;
  if (!anchor) return [];
  // Bias extension growth toward this room's sources — shortens the miner->filler leg.
  const atRcl = buildableAtRcl(GOAL, colony.controllerLevel, { anchor, sources: colony.sources });
  const stamped = stampLayout(atRcl, anchor);
  const roadReady = colony.energyCapacity >= ROADS_FROM_ENERGY_CAPACITY;
  // Bunker roads wait for the capacity gate; an operation's claimed roads (e.g. Mining's source
  // access) are never capacity-gated, only adjacency-gated below.
  const rawBuildable = [...(roadReady ? stamped : stamped.filter(p => p.type !== ROAD)), ...claimed];
  // Roads are gated after the merge, so a road adjacent to an operation's container counts as served.
  const buildable = gateRoads(rawBuildable, colony);
  // Ties within a type keep buildableAtRcl's original build-sequence order, so extension growth stays contiguous.
  return buildable
    .map((p, i) => ({ p, i }))
    .sort((a, b) => typePriority(a.p.type) - typePriority(b.p.type) || a.i - b.i)
    .map(e => e.p);
}

function placeAndDemolish(colony: ColonySnapshot, claimed: PlacedStructure[]): Intent[] {
  const anchor = colony.anchor!;
  // Full RCL8 goal, not this RCL's subset — a higher-tier structure built pre-downgrade must not read as stale.
  const goalAtAnchor = [...stampLayout(GOAL.placements, anchor), ...claimed];
  const prioritised = wantedStructures(colony, claimed);

  const cap = Math.min(FOCUS_SITE_CAP, MAX_CONSTRUCTION_SITES);
  let budget = cap - colony.sites.length;
  const out: Intent[] = [];
  for (const placement of prioritised) {
    if (budget <= 0) break;
    const exists = colony.structures.some(sameSpot(placement)) || colony.sites.some(sameSpot(placement));
    if (exists) continue;
    out.push({ kind: "placeSite", room: colony.name, x: placement.x, y: placement.y, type: placement.type });
    budget--;
  }

  // Tear down structures present but not part of the goal layout. Spawns are never auto-demolished — colony-fatal if wrong.
  for (const structure of colony.structures) {
    if (structure.type === "spawn") continue;
    if (goalAtAnchor.some(sameSpot(structure))) continue;
    out.push({ kind: "removeStructure", room: colony.name, x: structure.x, y: structure.y, type: structure.type });
  }

  return out;
}

// buildableAtRcl permits the full bunker road grid from RCL2 (permitted, not wanted); only keep roads that neighbour a served structure.
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
