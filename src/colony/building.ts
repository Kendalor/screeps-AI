// The construction arbiter — a Colony capability. It merges every operation's structures() claims
// with the bunker layout, orders them, spends the focus-site budget, and tears down what no
// operation claims. Pure: reads the snapshot, returns plain intents, never touches Game.*/Memory.
//
// Colony-scoped by nature: the claims are this colony's operations', the anchor and budget are this
// room's. It takes the snapshot and operations rather than a Colony to keep the dependency
// one-directional (colony/index.ts calls this; this never reaches back for the wrapper).

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
// Roads are dead weight while the bunker is still going up; hold until RCL4 when the colony can afford paving.
export const ROADS_FROM_RCL = 4;
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
  // Polled once and threaded through: an operation is asked what it wants exactly once per plan, so
  // placement and demolition cannot disagree about what was claimed this tick.
  return placeAndDemolish(colony, claimsOf(colony, operations));
}

/**
 * Every operation's claim, gathered **sequentially** so each sees what the ones before it planned.
 *
 * Not a flatMap: an operation that paths must path around the layout *and* around its siblings'
 * plans, or two operations heading for nearby targets lay two roads a tile apart instead of sharing
 * one. Since a planned road sits at ROAD_COST in the cost matrix, simply making prior claims visible
 * is enough — A* prefers the existing route on its own.
 *
 * The consequence is that `operationsFor()`'s order is now semantically load-bearing: the first
 * operation paths freely, later ones converge onto what is already planned.
 */
export function claimsOf(colony: ColonySnapshot, operations: Operation[]): PlacedStructure[] {
  // The layout is the baseline plan every operation paths against — intended, not yet built.
  //
  // This level's buildable subset, *not* the full RCL8 goal. The goal is a solid 13x13 block of 132
  // structures centred on the anchor, and buildCostMatrix marks every non-walkable type impassable:
  // pathing outward from the anchor against the complete goal is impossible, because the anchor is
  // sealed in by its own plan. The buildable subset is what the colony is actually committing to,
  // and it grows as the bunker fills in.
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

// Exported because integration benchmarks seed a colony at one RCL and need this same derivation to know the next level's target set.
// `claimed` is what the colony's operations asked for this tick — already state-gated by each
// operation (Mining withholds its containers below CONTAINERS_FROM_RCL), so this merges rather than re-gates.
export function wantedStructures(colony: ColonySnapshot, claimed: PlacedStructure[] = []): PlacedStructure[] {
  const anchor = colony.anchor;
  if (!anchor) return [];
  // Bias extension growth toward this room's sources — shortens the miner->filler leg.
  const atRcl = buildableAtRcl(GOAL, colony.controllerLevel, { anchor, sources: colony.sources });
  const rawBuildable = [...stampLayout(atRcl, anchor), ...claimed];
  const roadReady = colony.controllerLevel >= ROADS_FROM_RCL;
  // Roads are gated after the merge, so a road adjacent to an operation's container counts as served.
  const buildable = gateRoads(roadReady ? rawBuildable : rawBuildable.filter(p => p.type !== ROAD), colony);
  // Ties within a type keep buildableAtRcl's original build-sequence order, so extension growth stays contiguous.
  return buildable
    .map((p, i) => ({ p, i }))
    .sort((a, b) => typePriority(a.p.type) - typePriority(b.p.type) || a.i - b.i)
    .map(e => e.p);
}

function placeAndDemolish(colony: ColonySnapshot, claimed: PlacedStructure[]): Intent[] {
  const anchor = colony.anchor!;
  // Full RCL8 goal, not just this RCL's buildable subset: a higher-tier structure already built (e.g. after a downgrade) is not stale.
  // Operations' claims join it, so demolition tears down exactly what no operation claims this tick.
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
