// Construction: what to build, and who builds it.
//
//   - `planBuilding` — site placement from the bunker goal layout *plus* the
//     per-operation structures other systems declare (mining's source
//     containers, issue #22), tier 3 (docs/rewrite-skeleton.md §9 P2, #16).
//     One system owns construction: collecting declarations here is what lets
//     road gating see structures that aren't built yet.
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
import { minedStructures } from "./mining";

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

// Focus construction: cap open sites low so a small pre-storage workforce
// finishes a couple of structures instead of smearing effort across a whole
// RCL's backlog (gh #23 follow-up). Two at a time keeps the colony always
// building something without spreading thin.
const FOCUS_SITE_CAP = 2;
// Roads are dead weight while the structural bunker is still going up; hold them
// until RCL4, by which point extensions/tower/storage give the colony the
// capacity to afford paving.
export const ROADS_FROM_RCL = 4;
// Containers are for miners, and miners don't spawn until RCL3-with-extensions.
// A container placed earlier is 5000 energy nobody can use, and it would sit in
// a scarce focus slot starving the extensions that actually grow the colony —
// exactly the RCL2 stall observed on the live server. So hold containers until
// RCL3.
export const CONTAINERS_FROM_RCL = 3;
// Which sites win the scarce slots, most important first: tower (defense), then
// extensions (capacity growth), then containers, then storage. Containers rank
// below extensions — even once buildable they wait until extensions have the
// slots. Anything not listed (link, terminal, lab, spawn, ...) sorts after these
// at DEFAULT_PRIORITY; roads sort dead last so they only appear once structures
// are exhausted.
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

/**
 * Every structure this colony wants standing at its current controller level,
 * in the order it wants them: the RCL-capped bunker stamp plus the operational
 * structures other systems declare, with the roads/containers still held back
 * gated out, ranked by the same priority the site placement below consumes.
 *
 * Exported because "what does a finished RCL look like" is a question asked
 * from outside the tick too — the integration benchmarks seed a colony with the
 * previous level's structures and measure the climb to this level's set. They
 * derive both sets from here rather than restating them, so a change to the
 * layout, the caps, or the gating constants moves the tests with it instead of
 * silently leaving them measuring a stale target.
 */
export function wantedStructures(colony: ColonySnapshot): PlacedStructure[] {
  const anchor = colony.anchor;
  if (!anchor) return [];
  // Per-operation structures: the bunker stamp is not the whole story. Mining
  // declares a container/link beside each source (issue #22) — Base_2.json has
  // none by design. Collected here because one system owns site placement, and
  // because road gating below needs to see these tiles as structures worth
  // serving before the roads to them are planned.
  const operational = minedStructures(colony);
  const buildableOperational =
    colony.controllerLevel >= CONTAINERS_FROM_RCL ? operational : operational.filter(p => p.type !== "container");
  // The baked extension order grows a blob out from storage; which side of that
  // blob to extend first is a per-room choice, so bias it toward this room's
  // sources — the miner->filler leg is shorter when extensions face the sources.
  const atRcl = buildableAtRcl(GOAL, colony.controllerLevel, { anchor, sources: colony.sources });
  const rawBuildable = [...stampLayout(atRcl, anchor), ...buildableOperational];
  // Hold roads back entirely until RCL4, then gate the rest ("roads only where
  // needed") as before.
  const roadReady = colony.controllerLevel >= ROADS_FROM_RCL;
  const buildable = gateRoads(
    roadReady ? rawBuildable : rawBuildable.filter(p => p.type !== ROAD),
    colony
  );
  // Prioritise which sites claim the scarce slots: tower first, then extensions,
  // then containers/storage, everything else, roads last. buildableAtRcl already
  // returns placements in the baked build sequence, so the original index breaks
  // ties within a type and extension growth stays contiguous.
  return buildable
    .map((p, i) => ({ p, i }))
    .sort((a, b) => typePriority(a.p.type) - typePriority(b.p.type) || a.i - b.i)
    .map(e => e.p);
}

function planColony(colony: ColonySnapshot): Intent[] {
  const anchor = colony.anchor!;
  // Full RCL8 goal (not just this RCL's buildable subset): a structure from a
  // higher tier that's already built (e.g. after a downgrade) is not stale. The
  // goal check keeps all operational structures (they are never stale), but the
  // wanted set withholds containers until miners exist to use them.
  const goalAtAnchor = [...stampLayout(GOAL.placements, anchor), ...minedStructures(colony)];
  const prioritised = wantedStructures(colony);

  // Cap open sites low to keep construction focused (FOCUS_SITE_CAP), never
  // exceeding the engine's own room limit.
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
