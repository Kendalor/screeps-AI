// The construction arbiter: merges every operation's structures() claims with the bunker layout,
// orders them, spends the focus-site budget, and tears down what no operation claims. Pure.

import { plannedObstacles, buildableAtRcl } from "../layouts/goal";
import GOAL_JSON from "../layouts/Base_2.json";
import { stampLayout, type PlacedStructure } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import { range } from "../lib/geometry";
import { needsRepair } from "../lib/repairable";
import type { Intent } from "../intents/types";
import type { Operation } from "../operations";
import type { RoleName } from "../memory/schema";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

// Cap open sites low so a small pre-storage workforce finishes structures instead of smearing effort across the backlog.
const FOCUS_SITE_CAP = 2;
// At most one container construction site open at a time: a container is a big single-creep haul, so opening a
// second before the first is built just splits the builder's effort. Existing (built) containers don't count —
// only concurrent container *sites*. Containers still reach one-per-source over time, one at a time.
const MAX_CONTAINER_SITES = 1;
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
  // access) are never capacity- or adjacency-gated — claimed is the gate.
  const rawBuildable = [...(roadReady ? stamped : stamped.filter(p => p.type !== ROAD)), ...claimed];
  // Roads are gated after the merge, so a road adjacent to an operation's container counts as served.
  const buildable = gateRoads(rawBuildable, colony, claimed);
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
  // Only concurrent container *sites* are limited; built containers don't count against the cap.
  let containerSites = colony.sites.filter(s => s.type === "container").length;
  const out: Intent[] = [];
  for (const placement of prioritised) {
    if (budget <= 0) break;
    if (placement.type === "container" && containerSites >= MAX_CONTAINER_SITES) continue;
    const exists = colony.structures.some(sameSpot(placement)) || colony.sites.some(sameSpot(placement));
    if (exists) continue;
    out.push({ kind: "placeSite", room: colony.name, x: placement.x, y: placement.y, type: placement.type });
    if (placement.type === "container") containerSites++;
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

// buildableAtRcl permits the full bunker road grid from RCL2 (permitted, not wanted); only keep roads that neighbour
// a served structure. An operation's own claimed roads (e.g. Mining's multi-tile source access path) bypass this —
// most of a path's tiles sit between structures, not next to one, so adjacency alone would strip the middle out.
function gateRoads(buildable: PlacedStructure[], colony: ColonySnapshot, claimed: PlacedStructure[]): PlacedStructure[] {
  const claimedRoads = new Set(claimed.filter(p => p.type === ROAD).map(p => `${p.x},${p.y}`));
  const servedTiles = [
    ...colony.structures.filter(s => s.type !== ROAD),
    ...buildable.filter(s => s.type !== ROAD)
  ];
  return buildable.filter(
    p => p.type !== ROAD || claimedRoads.has(`${p.x},${p.y}`) || servedTiles.some(s => range(p, s) === 1)
  );
}

function sameSpot(a: PlacedStructure) {
  return (b: SnapStructure) => a.x === b.x && a.y === b.y && a.type === b.type;
}

// --- idle-builder repurposing -------------------------------------------------
// A builder outlives the construction it was spawned for: wantedBuilders drops to 0 the moment the last
// site completes, so no *new* builders spawn — but the ones already alive keep their ~1500-tick lease and,
// with their build step a no-op, fall through to harvesting (drop-mining) for nothing. Rather than let
// them idle-mine, convert them: to a repairer while anything is decaying, else to an upgrader. Both keep
// the builder's WORK/CARRY body doing real work for the rest of its life.

// Only convert once construction is *genuinely* finished, not merely paused between placements. placeAndDemolish
// releases sites a focus-cap at a time (up to FOCUS_SITE_CAP), so `colony.sites` legitimately hits zero for a
// stretch while a larger backlog still waits — converting then would strand real work. The planner's own
// backlog (wantedStructures minus what's already built or already a site) is the authoritative "is there
// anything left to build" signal, and it stays non-empty across those between-placement gaps.
export function hasOutstandingConstruction(colony: ColonySnapshot, claimed: PlacedStructure[]): boolean {
  if (colony.sites.length > 0) return true;
  return wantedStructures(colony, claimed).some(
    p => !colony.structures.some(sameSpot(p)) && !colony.sites.some(sameSpot(p))
  );
}

// A structure worth a repairer: decayed below the shared repair floor (src/lib/repairable.ts) — the
// same definition the repair role and tower repair use, so this, the role, and Defense never drift apart.
export function hasRepairWork(colony: ColonySnapshot): boolean {
  return colony.structures.some(s => s.hits !== undefined && s.hitsMax !== undefined && needsRepair(s.type, s.hits, s.hitsMax));
}

// Emits a role change for every owned builder once construction is finished: repair if anything is decaying,
// upgrader otherwise. Pure — the setCreepRole actuator owns the memory write. `claimed` must be the same
// operation claims planBuilding used this tick, so the backlog check agrees with what would be placed.
export function repurposeIdleBuilders(colony: ColonySnapshot, claimed: PlacedStructure[]): Intent[] {
  if (hasOutstandingConstruction(colony, claimed)) return [];
  const target: RoleName = hasRepairWork(colony) ? "repair" : "upgrader";
  return colony.creeps
    .filter(c => c.role === "builder" && c.room === colony.name)
    .map(c => ({ kind: "setCreepRole", creep: c.id, role: target }));
}
