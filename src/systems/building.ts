// Construction: what to build (site placement from the bunker goal layout plus per-operation structures like mining's
// source containers), and who builds it. Pure: reads the snapshot, returns plain data, never touches Game.*/Memory.

import GOAL_JSON from "../layouts/Base_2.json";
import type { Intent } from "../intents/types";
import { buildableAtRcl } from "../layouts/goal";
import type { PlacedStructure } from "../layouts/stamp";
import { stampLayout } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import { range } from "../lib/geometry";
import type { ColonySnapshot, EmpireSnapshot, SnapStructure } from "../snapshot/types";
import { minedStructures } from "./mining";

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

// Cap open sites low so a small pre-storage workforce finishes structures instead of smearing effort across the backlog.
const FOCUS_SITE_CAP = 2;
// Roads are dead weight while the bunker is still going up; hold until RCL4 when the colony can afford paving.
export const ROADS_FROM_RCL = 4;
// A container placed before miners exist is 5000 energy nobody can use, sitting in a scarce focus slot starving extensions.
export const CONTAINERS_FROM_RCL = 3;
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

export function desiredBuilderCount(colony: ColonySnapshot): number {
  if (colony.constructionProgress <= 0) return 0;
  // Pre-storage, bootstrap already builds via its step loop, so a dedicated builder would only double-staff construction.
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

// Exported because integration benchmarks seed a colony at one RCL and need this same derivation to know the next level's target set.
export function wantedStructures(colony: ColonySnapshot): PlacedStructure[] {
  const anchor = colony.anchor;
  if (!anchor) return [];
  // Mining declares a container/link beside each source; collected here since one system owns site placement and road gating
  // needs to see these tiles as structures worth serving.
  const operational = minedStructures(colony);
  const buildableOperational =
    colony.controllerLevel >= CONTAINERS_FROM_RCL ? operational : operational.filter(p => p.type !== "container");
  // Bias extension growth toward this room's sources — shortens the miner->filler leg.
  const atRcl = buildableAtRcl(GOAL, colony.controllerLevel, { anchor, sources: colony.sources });
  const rawBuildable = [...stampLayout(atRcl, anchor), ...buildableOperational];
  const roadReady = colony.controllerLevel >= ROADS_FROM_RCL;
  const buildable = gateRoads(
    roadReady ? rawBuildable : rawBuildable.filter(p => p.type !== ROAD),
    colony
  );
  // Ties within a type keep buildableAtRcl's original build-sequence order, so extension growth stays contiguous.
  return buildable
    .map((p, i) => ({ p, i }))
    .sort((a, b) => typePriority(a.p.type) - typePriority(b.p.type) || a.i - b.i)
    .map(e => e.p);
}

function planColony(colony: ColonySnapshot): Intent[] {
  const anchor = colony.anchor!;
  // Full RCL8 goal, not just this RCL's buildable subset: a higher-tier structure already built (e.g. after a downgrade) is not stale.
  const goalAtAnchor = [...stampLayout(GOAL.placements, anchor), ...minedStructures(colony)];
  const prioritised = wantedStructures(colony);

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
