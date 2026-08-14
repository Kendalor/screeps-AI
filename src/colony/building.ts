// The construction arbiter: merges every operation's structures() claims with the bunker layout,
// orders them, spends the focus-site budget, and tears down what no operation claims. Pure, with one
// deliberate exception: hasOutstandingConstruction reads/writes a narrow ColonyMemory cache field the
// same way snapshot/colony.ts's resolveAnchor already does for the anchor — see that function's own doc.

import { plannedObstacles, buildableAtRcl } from "../layouts/goal";
import GOAL_JSON from "../layouts/Base_2.json";
import { stampLayout, type PlacedStructure } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import type { XY } from "../lib/geometry";
import { needsRepair } from "../lib/repairable";
import { log } from "../lib/log";
import { wrapFn } from "../lib/profiler";
import type { Intent } from "../intents/types";
import type { Operation } from "../operations";
import { opName } from "../spawn/request";
import type { ColonySnapshot, SnapStructure } from "../snapshot/types";

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

// Cap open sites so a small pre-storage workforce finishes structures instead of smearing effort across the backlog.
export const FOCUS_SITE_CAP = 20;
// At most one container construction site open at a time: a container is a big single-creep haul, so opening a
// second before the first is built just splits the builder's effort. Existing (built) containers don't count —
// only concurrent container *sites*. Containers still reach one-per-source over time, one at a time.
export const MAX_CONTAINER_SITES = 1;
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
export function roomOf(p: PlacedStructure, colony: ColonySnapshot): string {
  return p.room ?? colony.name;
}

// The structures/sites actually standing in a room, home or remote. A remote room's arrays are only
// ever populated when it has vision this tick (see snapshot/colony.ts); Mining itself only claims a
// remote tile while its room is visible, so a claim reaching here for an invisible remote room never
// happens — `?? []` is just the safe default, not a case this is expected to hit.
function structuresAt(colony: ColonySnapshot, room: string): readonly SnapStructure[] {
  return room === colony.name ? colony.structures : (colony.remoteStructures[room] ?? []);
}
export function sitesAt(colony: ColonySnapshot, room: string): readonly SnapStructure[] {
  return room === colony.name ? colony.sites : (colony.remoteSites[room] ?? []);
}

// Genuinely built — not merely sited. This is what "is this source's group finished" gates on: a group
// with an open site but nothing built yet must still hold back the next group, or two groups end up
// building in parallel again, defeating the one-at-a-time point.
//
// A remote route road (room !== colony.name, sourceId set, type === road) additionally checks
// RemoteSourceMemory.routeBuilt via colony.remoteSources — live structuresAt() alone only covers the
// source's own room (colony.remoteStructures is never populated for a room the route merely transits
// through), so a transit-room road with no creep currently standing in it would otherwise never read as
// built and get re-claimed/re-placed forever (confirmed live on W47N14 2026-08-11: an already-built
// W46N14 corridor kept failing ERR_INVALID_TARGET every throttle tick, burning the whole remote site
// budget on tiles that were never actually missing).
export function builtAt(colony: ColonySnapshot, p: PlacedStructure): boolean {
  if (structuresAt(colony, roomOf(p, colony)).some(sameSpot(p))) return true;
  if (p.type !== ROAD || p.sourceId === undefined) return false;
  const source = colony.remoteSources.find(s => s.id === p.sourceId);
  if (!source?.route) return false;
  const index = source.route.findIndex(t => t.room === p.room && t.x === p.x && t.y === p.y);
  return index >= 0 && source.routeBuilt?.[index] === "1";
}

// Built or sited — the dedup check before placing a new site (don't place on top of either).
export function existingAt(colony: ColonySnapshot, p: PlacedStructure): boolean {
  return builtAt(colony, p) || sitesAt(colony, roomOf(p, colony)).some(sameSpot(p));
}

// Remote rooms currently unsafe to place a site or send a builder into — same definition as
// operations/building.ts's unsafeRemoteRooms (danger or a reservation held by someone else). Mining's
// own claim no longer withholds itself for this (see mining.ts's structures()), so this is now the
// only thing stopping a site from going up in a dangerous remote room; the home-room leg of the same
// route is never affected, since roomOf() only reads this set for non-home placements.
export function unsafeRemoteRooms(colony: ColonySnapshot): Set<string> {
  const out = new Set<string>();
  for (const s of colony.remoteSources) {
    if (s.danger > 0 || s.reservedBy !== undefined) out.add(s.room);
  }
  return out;
}

// Holds back every source group but the first not-yet-fully-built one, so a colony finishes one
// source's container+road before starting the next's — the same reasoning MAX_CONTAINER_SITES already
// applies to local containers, generalized to whole routes (local and remote alike) and to more than
// one at a time. Group order is first-appearance order in `claimed`, which mirrors Mining's own emission
// order (local sources, then colony.remoteSources — pickRemotes' own selection order): no new ranking
// metric invented here. Claims with no sourceId (bunker layout, controller path) are never touched.
//
// A group's incomplete claims sitting in a currently-unsafe remote room don't count toward "this group
// is still in progress" — it can't place there regardless (see placeAndDemolish's own unsafeRemote
// check), so treating it as blocking would stall every later group's construction for as long as the
// danger persists. Its own safe tiles (home-room leg, or already-built ones) stay eligible either way:
// an unsafe group is never dropped from the result, only skipped when picking which group's *remaining*
// work gates everyone else.
//
// `claimed` is grouped by sourceId ONCE up front (a single O(n) pass) rather than the original shape,
// which re-scanned the WHOLE `claimed` array once per distinct source group (order.find(id =>
// claimed.some(...))) — O(groups * claimed), each .some() call also invoking builtAt's own linear scans.
// Confirmed live (2026-08-13 CPU profiling, sub-span instrumentation): with 3-4 remotes and 37-65 tile
// routes each, `claimed` runs ~250-350 items and this was a real, if secondary, cost inside
// wantedStructures alongside gateRoads (see that function's own doc for the bigger fix). Same builtAt/
// blockedByDanger calls, same result — every claim is still classified exactly once now instead of once
// per group it might belong to.
function gateSourceGroups(colony: ColonySnapshot, claimed: readonly PlacedStructure[]): PlacedStructure[] {
  const unsafeRemote = unsafeRemoteRooms(colony);
  const blockedByDanger = (p: PlacedStructure) => !builtAt(colony, p) && unsafeRemote.has(roomOf(p, colony));

  const order: Id<Source>[] = [];
  const byGroup = new Map<Id<Source>, PlacedStructure[]>();
  for (const p of claimed) {
    if (p.sourceId === undefined) continue;
    let group = byGroup.get(p.sourceId);
    if (!group) {
      group = [];
      byGroup.set(p.sourceId, group);
      order.push(p.sourceId);
    }
    group.push(p);
  }
  const firstIncomplete = order.find(id => byGroup.get(id)!.some(p => !builtAt(colony, p) && !blockedByDanger(p)));
  // Every group is either fully built or currently only blocked by danger: nothing to throttle, so pass
  // every claim through as-is (each one's own safety gate in placeAndDemolish still applies).
  if (firstIncomplete === undefined) return claimed as PlacedStructure[];
  return claimed.filter(p => p.sourceId === undefined || p.sourceId === firstIncomplete || blockedByDanger(p));
}

export function planBuilding(colony: ColonySnapshot, operations: Operation[]): Intent[] {
  if (!colony.anchor) return [];
  // Polled once and threaded through, so placement and demolition can't disagree about what was claimed this tick.
  const claimed = claimsOf(colony, operations);
  writeBuildingPlan(colony, claimed);
  return placeAndDemolish(colony, claimed);
}

// The FINAL, fully-gated plan — exactly wantedStructures' own output (gateSourceGroups, adjacency-gated
// roads via gateRoads, substituteBlockedCapped, sort — every constraint placeAndDemolish itself respects),
// not a cheaper re-derivation. This is the write side of ColonyMemory.buildingPlan: called once per
// planBuilding's own `interval:100` cadence (kernel/tick.ts), never per-tick, so every OTHER reader
// (metrics' built/targeted counts, a live "what's missing and where" report) reads the real plan a cache
// hit away instead of either paying wantedStructures' full cost itself or — the mistake this replaced —
// reimplementing gateRoads/exit-tile/adjacency/substitution logic by hand and getting a different, wrong
// answer. Caching happens here, in the one module that owns this logic, for exactly that reason: any
// consumer that reached for its own approximation of "what does the plan want" would drift from what
// placeAndDemolish is actually doing the moment one of those filters changed.
//
// `targeted` is the UNTHROTTLED plan (wantedStructures' `throttleGroups: false`) — see that function's own
// doc: every remote group's full target, not just the one group placeAndDemolish is working through this
// firing, or a finished group would read as built-with-no-target the moment gateSourceGroups moves on.
// typeof-guarded like hasOutstandingConstruction's own Memory write, for the same reason: plain-object
// unit-test fixtures for this module don't stub a global Memory.
function writeBuildingPlan(colony: ColonySnapshot, claimed: PlacedStructure[]): void {
  if (typeof Memory === "undefined") return;
  const mem = Memory.colonies[colony.name];
  if (!mem) return;
  const targeted = wantedStructures(colony, claimed, false);
  mem.buildingPlan = targeted.map(p => ({
    type: p.type,
    x: p.x,
    y: p.y,
    room: roomOf(p, colony),
    sourceId: p.sourceId,
    built: builtAt(colony, p)
  }));
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
  // stampLayout is pure anchor-relative offset math — it has no notion of terrain, so a goal tile can
  // land on a real wall wherever this room's terrain doesn't mirror the room the layout was captured
  // in. Filtered here, not in stampLayout itself: pathing callers (e.g. Mining's sourceRoutes cost
  // matrix) need the layout's raw shape to route AROUND a blocked tile, not have it silently vanish
  // from their obstacle set. `claimed` is never filtered by this — every operation already derives its
  // own claims from a terrain-aware A*/PathFinder search (see layouts/roads.ts's buildCostMatrix), so a
  // claimed tile can never legitimately be a wall.
  //
  // This was latent, not newly introduced: Game.map.getRoomTerrain('W45N17').get(8,15) ===
  // TERRAIN_MASK_WALL, and Base_2.json's plain bunker grid (no sourceId) has always wanted a road
  // there. It stayed invisible before mining.ts's container-vs-road fix (2026-08-14) because
  // gateRoads (below) only keeps a bunker road adjacent to some *served* structure — with source
  // 5982fc07b097071b4adbca16's container claim silently dropped (the bug that fix addressed), nothing
  // stood at (8,14) to serve (8,15), so this wall tile correctly failed the adjacency gate and never
  // appeared in the plan at all. The moment that fix let the container claim survive, its 8-neighbour
  // ring (computed by gateRoads' neighbourKeys) newly covered (8,15), the road passed the adjacency
  // gate for the first time, and placeAndDemolish placed a real site on it — a road CAN legally be
  // built on wall terrain in Screeps (CONSTRUCTION_COST_ROAD_WALL_RATIO), so nothing rejected it. The
  // defect was always in the layout; the container fix only removed the accidental cover that had kept
  // it from ever being selected.
  const walkable = (p: XY) => colony.terrain[p.x * 50 + p.y] === 1;
  const stamped = substituteBlockedCapped(colony, stampLayout(atRcl, anchor).filter(walkable), anchor);
  const roadReady = colony.energyCapacity >= ROADS_FROM_ENERGY_CAPACITY;
  // Note: the terrain filter above runs BEFORE substituteBlockedCapped, so a wall-blocked CAPPED
  // placement (extension/tower/etc, unlike a road) currently just vanishes with no substitute — same
  // class of gap substituteBlockedCapped already closes for a spawn-blocked slot, just not extended to
  // terrain yet. Deliberately out of scope for this fix: the live incident this filter addresses is a
  // road (uncapped, no slot to lose); revisit if a capped type is ever actually seen losing an RCL slot
  // to terrain.
  //
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
  const unsafeRemote = unsafeRemoteRooms(colony);
  // Full RCL8 goal, not this RCL's subset — a higher-tier structure built pre-downgrade must not read as
  // stale. Only home-room claims: demolition never touches a remote room (no goal-layout concept exists
  // there), so a remote claim coincidentally sharing (x,y,type) with a home structure must not shield it.
  const homeClaimed = claimed.filter(p => roomOf(p, colony) === colony.name);
  const goalAtAnchor = [...stampLayout(GOAL.placements, anchor), ...homeClaimed];
  const prioritised = wantedStructures(colony, claimed);

  // Every home-room structure not part of the goal/claims. Split below into "blocking a wanted
  // placement" (only cleared the instant its replacement site actually goes up) vs. "wanted nowhere"
  // (over a type's count limit, or genuinely stale — torn down unconditionally since nothing waits on it).
  // Spawns are included here (unlike the old spawn-exempt filter) so a hand-placed spawn sitting on a
  // wanted tile is recognised as *the* blocker below — never demolished (can't be razed at low RCL/spawn
  // count), but its wanted placement is skipped instead of retried forever against an occupied tile.
  const wantedAt = new Set(goalAtAnchor.map(p => `${colony.name},${p.x},${p.y}`));
  const stale = colony.structures.filter(s => !goalAtAnchor.some(sameSpot(s)));
  const blocking = new Map(stale.filter(s => wantedAt.has(`${colony.name},${s.x},${s.y}`)).map(s => [`${colony.name},${s.x},${s.y}`, s]));
  const unwanted = stale.filter(s => s.type !== "spawn" && !wantedAt.has(`${colony.name},${s.x},${s.y}`));

  const cap = Math.min(FOCUS_SITE_CAP, MAX_CONSTRUCTION_SITES);
  // Two independent budgets, not one shared pool: a backlog of slow-to-build remote roads must never
  // starve home-room placement (extensions, towers, ...) of its own slots. Each still counts against
  // the same overall cap, just scoped to its own room set — siteSummary is vision-independent
  // (Game.constructionSites), so a remote site still counts even on a tick its room isn't visible.
  let homeBudget = cap - colony.siteSummary.filter(s => s.room === colony.name).length;
  let remoteBudget = cap - colony.siteSummary.filter(s => s.room !== colony.name).length;
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
    const room = roomOf(placement, colony);
    const home = room === colony.name;
    if (home ? homeBudget <= 0 : remoteBudget <= 0) continue;
    if (!home && unsafeRemote.has(room)) continue;
    if (placement.type === "container" && containerSites >= MAX_CONTAINER_SITES) continue;
    if (existingAt(colony, placement)) continue;
    const blocker = home ? blocking.get(`${colony.name},${placement.x},${placement.y}`) : undefined;
    // A spawn can never be razed (disallowed below the RCL/count that permits a second spawn) — skip
    // this placement entirely rather than retry createConstructionSite against an occupied tile every
    // tick forever. Left for a human to resolve (move the spawn, or accept the gap in the layout).
    if (blocker?.type === "spawn") {
      continue;
    }
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
    if (home) homeBudget--; else remoteBudget--;
  }

  return out;
}

// buildableAtRcl permits the full bunker road grid from RCL2 (permitted, not wanted); only keep roads that neighbour
// a served structure. An operation's own claimed roads (e.g. Mining's multi-tile source access path) bypass this —
// most of a path's tiles sit between structures, not next to one, so adjacency alone would strip the middle out.
//
// Adjacency (range===1, Chebyshev) is checked via a coordinate-keyed Set of every served tile's own
// 8-neighbour ring (excluding the tile itself — dx=0,dy=0 skipped, since range 0 is not range 1), not a
// servedTiles.some(...) scan per road candidate. A first attempt at this same rewrite (2026-08-13) was
// reverted for shipping unbenchmarked against real scale (a synthetic 60-structure/150-road test looked
// fast either way) AND for a correctness bug (the neighbour set wasn't excluding the self tile). Re-done
// properly this time: live sub-span profiling (recordManual instrumentation, see git history) confirmed
// gateRoads as wantedStructures' single largest cost (~300us/call, ~50% of the total) at the REAL scale —
// colonies here run 3-4 remotes with 37-65 tile routes each (confirmed via Memory.colonies.<room>.remotes),
// so `buildable`/servedTiles run ~250-350 items, not the ~200 the first synthetic test assumed. A
// realistic multi-room micro-benchmark at that scale (337 total placements, matching a real colony's
// bunker + 4 remote routes) confirmed BOTH correctness (0 mismatches against the original scan) and a
// real ~40% speedup (131us -> 78us/call) before this was deployed — see the benchmark script kept in this
// commit's description. Building the neighbour set is O(servedTiles); the road filter is then O(roads)
// with O(1) lookups, down from O(roads * servedTiles).
function neighbourKeys(x: number, y: number, room: string, out: Set<string>): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue; // the tile itself is range 0, not range 1 — must not count as its own neighbour
      out.add(`${room},${x + dx},${y + dy}`);
    }
  }
}

function gateRoads(buildable: PlacedStructure[], colony: ColonySnapshot, claimed: PlacedStructure[]): PlacedStructure[] {
  const key = (p: PlacedStructure) => `${roomOf(p, colony)},${p.x},${p.y}`;
  const claimedRoads = new Set(claimed.filter(p => p.type === ROAD).map(key));
  // Room-scoped: a tile in one room must never read as "served" by a structure that merely shares its
  // (x,y) in a different room — folded into the key itself rather than a separate roomOf(...)===roomOf(...) check.
  const servedNeighbours = new Set<string>();
  for (const s of colony.structures) {
    if (s.type !== ROAD) neighbourKeys(s.x, s.y, colony.name, servedNeighbours);
  }
  for (const s of buildable) {
    if (s.type !== ROAD) neighbourKeys(s.x, s.y, roomOf(s, colony), servedNeighbours);
  }
  return buildable.filter(p => p.type !== ROAD || claimedRoads.has(key(p)) || servedNeighbours.has(key(p)));
}

function sameSpot(a: PlacedStructure) {
  return (b: SnapStructure) => a.x === b.x && a.y === b.y && a.type === b.type;
}

// A capped-in placement occupied by a structure that can never be razed (only spawns, currently — see
// placeAndDemolish's own blocker?.type === "spawn" check) would otherwise sit skipped forever, silently
// costing the colony one structure of that type versus the RCL cap. Swap it for the next-best same-type
// placement from the *full* RCL8 goal (beyond what buildableAtRcl capped in) that isn't itself already
// wanted, built, or sited — so the slot count at this RCL stays intact instead of quietly shrinking.
// Order-preserving: the substitute takes the blocked placement's position in the list so build-sequence
// contiguity (buildableAtRcl's whole point) is unaffected.
function substituteBlockedCapped(colony: ColonySnapshot, capped: PlacedStructure[], anchor: XY): PlacedStructure[] {
  const cappedKey = new Set(capped.map(p => `${p.type},${p.x},${p.y}`));
  const fullByType = new Map<BuildableStructureConstant, PlacedStructure[]>();
  for (const p of stampLayout(GOAL.placements, anchor)) {
    (fullByType.get(p.type) ?? fullByType.set(p.type, []).get(p.type)!).push(p);
  }

  return capped.map(placement => {
    if (existingAt(colony, placement)) return placement;
    const blocker = colony.structures.find(s => s.x === placement.x && s.y === placement.y);
    if (blocker?.type !== "spawn") return placement;

    const pool = fullByType.get(placement.type) ?? [];
    const replacement = pool.find(
      p => !cappedKey.has(`${p.type},${p.x},${p.y}`) && !existingAt(colony, p) && !colony.structures.some(s => s.x === p.x && s.y === p.y)
    );
    if (!replacement) return placement; // no substitute available — fall back to the old skip behaviour

    cappedKey.delete(`${placement.type},${placement.x},${placement.y}`);
    cappedKey.add(`${replacement.type},${replacement.x},${replacement.y}`);
    return replacement;
  });
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
//
// Remote sites count too: Building's own wantedBuilders() sizes its workforce off home + remote progress
// (see operations/building.ts's totalConstructionProgress), so this must agree or a live remote backlog
// gets read as "finished" and strands every builder into repair/upgrade while roads sit at 0 progress.
//
// Per-type target count for the bunker layout portion only (not `claimed` — see hasOutstandingConstruction's
// own doc for why operation claims are checked separately, item by item). Mirrors wantedStructures' own
// road gate (colony.energyCapacity >= ROADS_FROM_ENERGY_CAPACITY) but skips substituteBlockedCapped/
// gateRoads/sort entirely: a straight per-type COUNT never needs to know which specific tile a structure
// sits on, only how many of each type the RCL currently permits — substituteBlockedCapped exists purely to
// keep a spawn-blocked slot's COUNT from silently shrinking (see its own doc), so a count comparison
// against buildableAtRcl's raw cap is already correct without re-deriving which tile the substitute landed
// on. buildableAtRcl itself is already cached (see layouts/goal.ts) — this only adds one more cheap pass
// over its (already-computed) result.
function bunkerTargetCounts(colony: ColonySnapshot): Partial<Record<BuildableStructureConstant, number>> {
  const anchor = colony.anchor;
  if (!anchor) return {};
  const atRcl = buildableAtRcl(GOAL, colony.controllerLevel, { anchor, sources: colony.sources });
  const roadReady = colony.energyCapacity >= ROADS_FROM_ENERGY_CAPACITY;
  const counts: Partial<Record<BuildableStructureConstant, number>> = {};
  for (const p of atRcl) {
    if (p.type === ROAD && !roadReady) continue;
    counts[p.type] = (counts[p.type] ?? 0) + 1;
  }
  return counts;
}

// True while any bunker-layout type has fewer built+sited (home room only) than its RCL cap wants.
// Deliberately count-only (no positions) — see bunkerTargetCounts' own doc for why that's still correct
// even with substituteBlockedCapped in the picture.
function bunkerBacklogRemains(colony: ColonySnapshot): boolean {
  const wanted = bunkerTargetCounts(colony);
  const have: Partial<Record<BuildableStructureConstant, number>> = {};
  for (const s of colony.structures) have[s.type] = (have[s.type] ?? 0) + 1;
  for (const s of colony.sites) have[s.type] = (have[s.type] ?? 0) + 1;
  for (const type in wanted) {
    const t = type as BuildableStructureConstant;
    if ((have[t] ?? 0) < wanted[t]!) return true;
  }
  return false;
}

// One entry in the cached FINAL plan (ColonyMemory.buildingPlan) — the exact list placeAndDemolish places
// construction sites from, with each entry's own built/not-yet-built status already resolved via builtAt
// at write time. `built` is a snapshot of that one write tick, same staleness rule the rest of the cache
// has (accurate as of the last `interval:100` firing, not live). `room`/`sourceId` mirror PlacedStructure's
// own fields (roomOf's resolved room, not the raw possibly-absent one) so a consumer never has to re-derive
// them or re-import roomOf.
export interface BuildingPlanEntry {
  type: BuildableStructureConstant;
  x: number;
  y: number;
  room: string;
  sourceId?: Id<Source>;
  built: boolean;
}

// Per-type {built, targeted} — cheap math (one linear pass, no gating logic) over the already-fully-gated
// ColonyMemory.buildingPlan cache, for the metrics panel's "Buildings" row. This is what "metrics is
// read-only + math" means concretely: aggregating an already-governed positional list, never recomputing
// or reapproximating the gating (gateRoads adjacency, substituteBlockedCapped, exit tiles, source-group
// throttling) that only wantedStructures itself may decide — see writeBuildingPlan's own doc for why that
// distinction matters.
export function buildingRowsFromPlan(plan: readonly BuildingPlanEntry[]): { type: BuildableStructureConstant; built: number; targeted: number }[] {
  const targetBy: Partial<Record<BuildableStructureConstant, number>> = {};
  const builtBy: Partial<Record<BuildableStructureConstant, number>> = {};
  for (const p of plan) {
    targetBy[p.type] = (targetBy[p.type] ?? 0) + 1;
    if (p.built) builtBy[p.type] = (builtBy[p.type] ?? 0) + 1;
  }

  const types = new Set<BuildableStructureConstant>(Object.keys(targetBy) as BuildableStructureConstant[]);
  return [...types]
    .map(type => ({ type, built: builtBy[type] ?? 0, targeted: targetBy[type] ?? 0 }))
    .sort(
      (a, b) =>
        b.targeted - b.built - (a.targeted - a.built) || // most still to build first
        b.targeted - a.targeted ||
        a.type.localeCompare(b.type)
    );
}

// Everything that can flip the expensive fallback's answer (bunkerBacklogRemains / claimed.some below),
// joined into one cheap string: structure/site counts (something built, demolished, or newly sited),
// energyCapacity (crosses ROADS_FROM_ENERGY_CAPACITY), controllerLevel (RCL-up permits more), and
// claimed's own length (an operation's demand changed, e.g. a new remote selected). Every one of these
// is already a plain number/length read off the snapshot — no iteration beyond what the caller already
// paid for building `claimed`.
function outstandingConstructionFingerprint(colony: ColonySnapshot, claimed: PlacedStructure[]): string {
  return [
    colony.structures.length,
    colony.sites.length,
    colony.siteSummary.length,
    colony.energyCapacity,
    colony.controllerLevel,
    claimed.length
  ].join(",");
}

// `wanted` lets a caller that already computed this tick's wantedStructures(colony, claimed) (throttled)
// pass it straight through instead of this recomputing it from scratch. No current caller does — Colony.
// maintainWorkforce() deliberately omits it (see that method's own doc: forcing a positional plan just to
// hand it over here would defeat the point of the cheaper paths below) — kept as a parameter so a future
// caller that's already paid for wantedStructures this tick for its OWN reason isn't forced to redo the
// (cheap, but not free) existingAt scan below. Omitted, the fallback below is answered from a cross-tick cache
// (ColonyMemory.outstandingConstructionCache) instead of a fresh count/positional check every tick —
// construction sites aren't placed every tick (placeAndDemolish is throttled, interval:100 — see
// kernel/tick.ts) and a site doesn't finish building every tick either (real per-tick builder progress,
// not an event this code observes directly), so the fallback's answer is stable almost every tick in
// steady state. Invalidated whenever outstandingConstructionFingerprint changes — cheaper than the
// bunkerBacklogRemains/claimed.some checks it guards, and correct by construction: anything that could
// flip the real answer necessarily changes at least one of the counts the fingerprint reads (see its own
// doc). Confirmed live (2026-08-13 CPU profiling): even the count-only fallback (no positions, no
// gateRoads/sort) still cost ~110us/call — a straight cache hit is a single string comparison instead.
export const hasOutstandingConstruction = wrapFn(function hasOutstandingConstruction(
  colony: ColonySnapshot,
  claimed: PlacedStructure[],
  wanted?: PlacedStructure[]
): boolean {
  if (colony.sites.length > 0) return true;
  if (colony.siteSummary.some(s => s.room !== colony.name)) return true;
  if (wanted) return wanted.some(p => !existingAt(colony, p));

  const fingerprint = outstandingConstructionFingerprint(colony, claimed);
  // typeof-guarded like transport.ts's parkNearBunker/homeRoomWaypoint — plain-object unit-test fixtures
  // for this module don't stub a global Memory at all, only the real Game/kernel entry point does.
  const mem = typeof Memory !== "undefined" ? Memory.colonies[colony.name] : undefined;
  const cached = mem?.outstandingConstructionCache;
  if (cached && cached.fingerprint === fingerprint) return cached.value;

  const value = bunkerBacklogRemains(colony) || claimed.some(p => !existingAt(colony, p));
  if (mem) mem.outstandingConstructionCache = { fingerprint, value };
  return value;
}, "building:hasOutstandingConstruction");

// A structure worth a repairer: decayed below the shared repair floor (src/lib/repairable.ts) — the
// same definition the repair role and tower repair use, so this, the role, and Defense never drift apart.
export function hasRepairWork(colony: ColonySnapshot): boolean {
  return colony.structures.some(s => s.hits !== undefined && s.hitsMax !== undefined && needsRepair(s.type, s.hits, s.hitsMax));
}

// role -> the operation kind that owns it post-conversion, for the op stamp below. Both target roles'
// operations report their own roleTargets() (see operations/repairing.ts, operations/upgrading.ts), so
// stamping the right op lets that operation's owned() pick the converted creep up as its own — and, just
// as importantly, keeps every *other* operation's default roleTargets() from also claiming it (see
// intents/execute.ts's setCreepRole case for why an unstamped op is the actual bug this guards against).
const REPURPOSE_OP_KIND: Record<"repair" | "upgrader", string> = { repair: "repairing", upgrader: "upgrading" };

// Emits a role change for every owned builder once construction is finished: repair if anything is decaying,
// upgrader otherwise. Pure — the setCreepRole actuator owns the memory write. `claimed` must be the same
// operation claims planBuilding used this tick, so the backlog check agrees with what would be placed.
// `wanted` is forwarded to hasOutstandingConstruction as-is — see that function's own doc for why a
// caller with a per-tick cached wantedStructures result should pass it through here.
export const repurposeIdleBuilders = wrapFn(function repurposeIdleBuilders(
  colony: ColonySnapshot,
  claimed: PlacedStructure[],
  wanted?: PlacedStructure[]
): Intent[] {
  if (hasOutstandingConstruction(colony, claimed, wanted)) return [];
  const target: "repair" | "upgrader" = hasRepairWork(colony) ? "repair" : "upgrader";
  const op = opName(REPURPOSE_OP_KIND[target], colony.name);
  return colony.creeps
    .filter(c => c.role === "builder" && c.room === colony.name)
    .map(c => ({ kind: "setCreepRole", creep: c.id, role: target, op }));
}, "building:repurposeIdleBuilders");
