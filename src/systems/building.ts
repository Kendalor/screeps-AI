// Construction: what to build (site placement from the bunker goal layout plus per-operation structures like mining's
// source containers), and who builds it. Pure: reads the snapshot, returns plain data, never touches Game.*/Memory.

import GOAL_JSON from "../layouts/Base_2.json";
import { orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { Colony } from "../colony";
import type { Intent } from "../intents/types";
// Aliased: this file already has a DEFAULT_PRIORITY for structure types, which is unrelated.
import { DEFAULT_PRIORITY as CREEP_PRIORITY, fillTo, opName, type CreepRequest } from "../spawn/request";
import { buildableAtRcl, plannedObstacles } from "../layouts/goal";
import type { PlacedStructure } from "../layouts/stamp";
import { stampLayout } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import { range } from "../lib/geometry";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";
import { bodyContext } from "./spawnContext";

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
const DEFAULT_PRIORITY = 10;
const ROAD_PRIORITY = 99;

function typePriority(type: BuildableStructureConstant): number {
  if (type === ROAD) return ROAD_PRIORITY;
  return TYPE_PRIORITY[type] ?? DEFAULT_PRIORITY;
}

// One builder per 5k of outstanding work, never more than 4 — an uncapped quota would starve every other role of spawn capacity.
const PROGRESS_PER_BUILDER = 5_000;
const MAX_BUILDERS = 4;
// Storage must clear this reserve plus the outstanding sites' cost before dedicated builders are affordable.
const STORAGE_RESERVE = 50_000;

function wantedBuilders(colony: ColonySnapshot): number {
  if (colony.constructionProgress <= 0) return 0;
  // Pre-storage, bootstrap already builds via its step loop, so a dedicated builder would only double-staff construction.
  if (colony.storageEnergy <= 0) return 0;
  if (colony.storageEnergy < STORAGE_RESERVE + colony.constructionProgress) return 0;
  return Math.min(MAX_BUILDERS, Math.ceil(colony.constructionProgress / PROGRESS_PER_BUILDER));
}

export function builderRequests({ snapshot: colony }: Colony): CreepRequest[] {
  return fillTo(
    wantedBuilders(colony),
    colony.creeps.filter(c => c.role === "builder").length,
    orderBody(roleDef("builder")?.body(colony.energyCapacity, bodyContext(colony)) ?? []),
    CREEP_PRIORITY.builder,
    { role: "builder", home: colony.name, op: opName("building", colony.name) }
  );
}

export function planBuilding(colony: Colony): Intent[] {
  if (!colony.snapshot.anchor) return [];
  // Polled once and threaded through: an operation is asked what it wants exactly once per plan, so
  // placement and demolition cannot disagree about what was claimed this tick.
  return planColony(colony.snapshot, claimsOf(colony));
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
export function claimsOf(colony: Colony): PlacedStructure[] {
  const snap = colony.snapshot;
  // The layout is the baseline plan every operation paths against — intended, not yet built.
  //
  // This level's buildable subset, *not* the full RCL8 goal. The goal is a solid 13x13 block of 132
  // structures centred on the anchor, and buildCostMatrix marks every non-walkable type impassable:
  // pathing outward from the anchor against the complete goal is impossible, because the anchor is
  // sealed in by its own plan. The buildable subset is what the colony is actually committing to,
  // and it grows as the bunker fills in.
  const planned: PlacedStructure[] = stampLayout(
    plannedObstacles(GOAL, snap.controllerLevel, snap.anchor!, snap.sources),
    snap.anchor!
  );
  const claimed: PlacedStructure[] = [];
  for (const op of colony.operations) {
    const claim = op.structures(colony.snapshot, planned);
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

function planColony(colony: ColonySnapshot, claimed: PlacedStructure[]): Intent[] {
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
