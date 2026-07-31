// The construction arbiter: merges every operation's structures() claims with the bunker layout,
// orders them, spends the focus-site budget, and tears down what no operation claims. Pure.

import { plannedObstacles, buildableAtRcl } from "../layouts/goal";
import GOAL_JSON from "../layouts/Base_2.json";
import { stampLayout, type PlacedStructure } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import { range } from "../lib/geometry";
import { needsRepair } from "../lib/repairable";
import { log } from "../lib/log";
import { wrapFn } from "../lib/profiler";
import type { Intent } from "../intents/types";
import type { Operation } from "../operations";
import type { RoleName } from "../memory/schema";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

// Cap open sites so a small pre-storage workforce finishes structures instead of smearing effort across the backlog.
const FOCUS_SITE_CAP = 20;
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

// Room resolution for a claim: absent means the colony's own home room (every pre-existing producer —
// bunker layout, controller path — is implicitly home and never sets this).
function roomOf(p: PlacedStructure, colony: ColonySnapshot): string {
  return p.room ?? colony.name;
}

// The structures/sites actually standing in a room, home or remote. A remote room's arrays are only
// ever populated when it has vision this tick (see snapshot/colony.ts); Mining itself only claims a
// remote tile while its room is visible, so a claim reaching here for an invisible remote room never
// happens — `?? []` is just the safe default, not a case this is expected to hit.
function structuresAt(colony: ColonySnapshot, room: string): readonly SnapStructure[] {
  return room === colony.name ? colony.structures : (colony.remoteStructures[room] ?? []);
}
function sitesAt(colony: ColonySnapshot, room: string): readonly SnapStructure[] {
  return room === colony.name ? colony.sites : (colony.remoteSites[room] ?? []);
}

// Genuinely built — not merely sited. This is what "is this source's group finished" gates on: a group
// with an open site but nothing built yet must still hold back the next group, or two groups end up
// building in parallel again, defeating the one-at-a-time point.
function builtAt(colony: ColonySnapshot, p: PlacedStructure): boolean {
  return structuresAt(colony, roomOf(p, colony)).some(sameSpot(p));
}

// Built or sited — the dedup check before placing a new site (don't place on top of either).
function existingAt(colony: ColonySnapshot, p: PlacedStructure): boolean {
  return builtAt(colony, p) || sitesAt(colony, roomOf(p, colony)).some(sameSpot(p));
}

// Holds back every source group but the first not-yet-fully-built one, so a colony finishes one
// source's container+road before starting the next's — the same reasoning MAX_CONTAINER_SITES already
// applies to local containers, generalized to whole routes (local and remote alike) and to more than
// one at a time. Group order is first-appearance order in `claimed`, which mirrors Mining's own emission
// order (local sources, then colony.remoteSources — pickRemotes' own selection order): no new ranking
// metric invented here. Claims with no sourceId (bunker layout, controller path) are never touched.
function gateSourceGroups(colony: ColonySnapshot, claimed: readonly PlacedStructure[]): PlacedStructure[] {
  const order: Id<Source>[] = [];
  for (const p of claimed) {
    if (p.sourceId !== undefined && !order.includes(p.sourceId)) order.push(p.sourceId);
  }
  const firstIncomplete = order.find(id => claimed.some(p => p.sourceId === id && !builtAt(colony, p)));
  if (firstIncomplete === undefined) return claimed as PlacedStructure[]; // every group already built, or none exist
  return claimed.filter(p => p.sourceId === undefined || p.sourceId === firstIncomplete);
}

export function planBuilding(colony: ColonySnapshot, operations: Operation[]): Intent[] {
  if (!colony.anchor) return [];
  // Polled once and threaded through, so placement and demolition can't disagree about what was claimed this tick.
  return placeAndDemolish(colony, claimsOf(colony, operations));
}

// Gathered sequentially, not flatMap: each operation paths around the layout and around siblings' plans already claimed,
// so two operations heading for nearby targets share a road instead of laying two. operationsFor()'s order is load-bearing.
// No anchor yet (very early boot, before resolveAnchor finds one) means no layout to claim against.
export const claimsOf = wrapFn(function claimsOf(colony: ColonySnapshot, operations: Operation[]): PlacedStructure[] {
  if (!colony.anchor) return [];
  // This level's buildable subset, not the full RCL8 goal — the full goal seals the anchor in, making it unpathable from itself.
  const planned: PlacedStructure[] = stampLayout(
    plannedObstacles(GOAL, colony.controllerLevel, colony.anchor, colony.sources),
    colony.anchor
  );
  const claimed: PlacedStructure[] = [];
  for (const op of operations) {
    const claim = op.structures(colony, planned);
    claimed.push(...claim);
    planned.push(...claim);
  }
  return claimed;
}, "building:claimsOf");

// Exported for integration benchmarks. `claimed` is already state-gated per operation, so this merges rather than re-gates.
// `throttleGroups` defaults on (one source group in progress at a time, matching what placeAndDemolish
// will actually place this tick). The metrics panel passes false: it wants the full plan across every
// remote group as its "targeted" denominator, not just the group currently being worked on — otherwise
// a finished group's structures would count as built with no target, and built could exceed targeted.
export const wantedStructures = wrapFn(function wantedStructures(
  colony: ColonySnapshot,
  claimed: PlacedStructure[] = [],
  throttleGroups = true
): PlacedStructure[] {
  const anchor = colony.anchor;
  if (!anchor) return [];
  // One source group (local or remote) at a time — see gateSourceGroups.
  const gated = throttleGroups ? gateSourceGroups(colony, claimed) : claimed;
  // Bias extension growth toward this room's sources — shortens the miner->filler leg.
  const atRcl = buildableAtRcl(GOAL, colony.controllerLevel, { anchor, sources: colony.sources });
  const stamped = stampLayout(atRcl, anchor);
  const roadReady = colony.energyCapacity >= ROADS_FROM_ENERGY_CAPACITY;
  // Bunker roads wait for the capacity gate; an operation's claimed roads (e.g. Mining's source
  // access) are never capacity- or adjacency-gated — claimed is the gate.
  const rawBuildable = [...(roadReady ? stamped : stamped.filter(p => p.type !== ROAD)), ...gated];
  // Roads are gated after the merge, so a road adjacent to an operation's container counts as served.
  const buildable = gateRoads(rawBuildable, colony, gated);
  // Ties within a type keep buildableAtRcl's original build-sequence order, so extension growth stays contiguous.
  return buildable
    .map((p, i) => ({ p, i }))
    .sort((a, b) => typePriority(a.p.type) - typePriority(b.p.type) || a.i - b.i)
    .map(e => e.p);
}, "building:wantedStructures");

function placeAndDemolish(colony: ColonySnapshot, claimed: PlacedStructure[]): Intent[] {
  const anchor = colony.anchor!;
  // Full RCL8 goal, not this RCL's subset — a higher-tier structure built pre-downgrade must not read as
  // stale. Only home-room claims: demolition never touches a remote room (no goal-layout concept exists
  // there), so a remote claim coincidentally sharing (x,y,type) with a home structure must not shield it.
  const homeClaimed = claimed.filter(p => roomOf(p, colony) === colony.name);
  const goalAtAnchor = [...stampLayout(GOAL.placements, anchor), ...homeClaimed];
  const prioritised = wantedStructures(colony, claimed);

  // Every home-room structure not part of the goal/claims. Split below into "blocking a wanted
  // placement" (only cleared the instant its replacement site actually goes up) vs. "wanted nowhere"
  // (over a type's count limit, or genuinely stale — torn down unconditionally since nothing waits on it).
  const wantedAt = new Set(goalAtAnchor.map(p => `${colony.name},${p.x},${p.y}`));
  const stale = colony.structures.filter(s => s.type !== "spawn" && !goalAtAnchor.some(sameSpot(s)));
  const blocking = new Map(stale.filter(s => wantedAt.has(`${colony.name},${s.x},${s.y}`)).map(s => [`${colony.name},${s.x},${s.y}`, s]));
  const unwanted = stale.filter(s => !wantedAt.has(`${colony.name},${s.x},${s.y}`));

  const cap = Math.min(FOCUS_SITE_CAP, MAX_CONSTRUCTION_SITES);
  // The shared budget counts every site this colony actually owns (home + selected remote rooms), not
  // just placement attempts — siteSummary is vision-independent (Game.constructionSites), so a remote
  // site still counts even on a tick its room isn't visible.
  let budget = cap - colony.siteSummary.length;
  // Only concurrent container *sites* are limited; built containers don't count against the cap.
  let containerSites = colony.siteSummary.filter(s => s.type === "container").length;
  const out: Intent[] = [];

  // Structures nobody wants at all: clear immediately, regardless of whether anything places this tick —
  // freeing the count/footprint has value on its own, with no replacement to wait on.
  for (const structure of unwanted) {
    log.info(
      `demolish (unwanted) ${structure.type}@${colony.name}(${structure.x},${structure.y}): not part of goal layout or claims`
    );
    out.push({ kind: "removeStructure", room: colony.name, x: structure.x, y: structure.y, type: structure.type });
  }

  for (const placement of prioritised) {
    if (budget <= 0) break;
    if (placement.type === "container" && containerSites >= MAX_CONTAINER_SITES) continue;
    if (existingAt(colony, placement)) continue;
    const blocker = roomOf(placement, colony) === colony.name ? blocking.get(`${colony.name},${placement.x},${placement.y}`) : undefined;
    // Clear the blocker in the same tick, immediately before the site — never ahead of the placement
    // actually happening, so a finished building isn't left demolished while its replacement waits its
    // turn in the backlog (see wantedStructures' focus-site budget).
    if (blocker) {
      log.info(
        `demolish (blocking) ${blocker.type}@${colony.name}(${blocker.x},${blocker.y}): replaced by ${placement.type} this tick`
      );
      out.push({ kind: "removeStructure", room: colony.name, x: blocker.x, y: blocker.y, type: blocker.type });
    }
    out.push({ kind: "placeSite", room: roomOf(placement, colony), x: placement.x, y: placement.y, type: placement.type });
    if (placement.type === "container") containerSites++;
    budget--;
  }

  return out;
}

// buildableAtRcl permits the full bunker road grid from RCL2 (permitted, not wanted); only keep roads that neighbour
// a served structure. An operation's own claimed roads (e.g. Mining's multi-tile source access path) bypass this —
// most of a path's tiles sit between structures, not next to one, so adjacency alone would strip the middle out.
function gateRoads(buildable: PlacedStructure[], colony: ColonySnapshot, claimed: PlacedStructure[]): PlacedStructure[] {
  const key = (p: PlacedStructure) => `${roomOf(p, colony)},${p.x},${p.y}`;
  const claimedRoads = new Set(claimed.filter(p => p.type === ROAD).map(key));
  // Room-scoped: a tile in one room must never read as "served" by a structure that merely shares its
  // (x,y) in a different room.
  const servedTiles: PlacedStructure[] = [
    ...colony.structures.filter(s => s.type !== ROAD).map(s => ({ x: s.x, y: s.y, type: s.type, room: colony.name })),
    ...buildable.filter(s => s.type !== ROAD)
  ];
  return buildable.filter(
    p => p.type !== ROAD || claimedRoads.has(key(p)) || servedTiles.some(s => roomOf(s, colony) === roomOf(p, colony) && range(p, s) === 1)
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
export const hasOutstandingConstruction = wrapFn(function hasOutstandingConstruction(colony: ColonySnapshot, claimed: PlacedStructure[]): boolean {
  if (colony.sites.length > 0) return true;
  // Home-room claims only: whether a local "builder" should ever go work a remote site is the builder-
  // dispatch question this feature deliberately defers. The miner already builds/repairs its own remote
  // container (behaviors/roles/miner.ts), so nothing here needs to know about remote backlog at all.
  return wantedStructures(colony, claimed)
    .filter(p => roomOf(p, colony) === colony.name)
    .some(p => !existingAt(colony, p));
}, "building:hasOutstandingConstruction");

// A structure worth a repairer: decayed below the shared repair floor (src/lib/repairable.ts) — the
// same definition the repair role and tower repair use, so this, the role, and Defense never drift apart.
export function hasRepairWork(colony: ColonySnapshot): boolean {
  return colony.structures.some(s => s.hits !== undefined && s.hitsMax !== undefined && needsRepair(s.type, s.hits, s.hitsMax));
}

// Emits a role change for every owned builder once construction is finished: repair if anything is decaying,
// upgrader otherwise. Pure — the setCreepRole actuator owns the memory write. `claimed` must be the same
// operation claims planBuilding used this tick, so the backlog check agrees with what would be placed.
export const repurposeIdleBuilders = wrapFn(function repurposeIdleBuilders(colony: ColonySnapshot, claimed: PlacedStructure[]): Intent[] {
  if (hasOutstandingConstruction(colony, claimed)) return [];
  const target: RoleName = hasRepairWork(colony) ? "repair" : "upgrader";
  return colony.creeps
    .filter(c => c.role === "builder" && c.room === colony.name)
    .map(c => ({ kind: "setCreepRole", creep: c.id, role: target }));
}, "building:repurposeIdleBuilders");
