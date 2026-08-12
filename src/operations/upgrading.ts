// Upgrading owns the upgrader workforce and its infrastructure: how many upgraders given stored
// energy, plus the controller container/road that keeps them fed without a hauler round trip. Pure.

import { roleDef } from "../behaviors/roles";
import { bodyContext } from "../spawn/bodyContext";
import { countPart } from "../spawn/body";
import GOAL_JSON from "../layouts/Base_2.json";
import { plannedObstacles } from "../layouts/goal";
import { buildCostMatrix, controllerContainerPath, type RoadPathResult } from "../layouts/roads";
import { stampLayout, type PlacedStructure } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import type { Intent } from "../intents/types";
import type { XY } from "../lib/geometry";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { incomePerTick, sustainableBuildWork } from "./building";
import { Operation, type RoleTarget } from "./operation";

const upgraderConfig = {
  // Below this, storage is reserved for other spending; above it, one extra upgrader per 40k stored.
  storageReserve: 100_000,
  storagePerUpgrader: 40_000,
  maxStorageUpgraders: 4,

  // Pre-storage overflow sink: holds at floor while sites are outstanding, then scales with surplus.
  minPreStorageUpgraders: 1,
  surplusPerUpgrader: 1_000, // standing surplus absorbed per extra upgrader
  maxUpgraders: 6, // hard ceiling regardless of regime — mirrors Building's worker cap

  // Room energyCapacity at which the controller gets its own container + road (RCL2 + all five
  // extensions = 550). Before this the room can't spare the build; after it, the container ends the
  // upgraders' walk to storage.
  containerFromEnergyCapacity: 550,
  // RCL5 is when the first 2 links unlock — same moment the container stops being needed: a link at
  // the controller receives straight from the core link, no hauler/road walk at all. Mirrors mining.ts's
  // linkRcl swap (container -> link) for the source side.
  linkRcl: 5,
  // Same range structures()' own controllerContainerPath targets (UPGRADE_CONTAINER_RANGE in
  // layouts/roads.ts) and graph.ts's controller-container consumer check — kept as its own constant
  // here since intents() below detects the built link by proximity, not by matching structures()'
  // exact A*-derived tile (see the controller-link detection doc comment on intents()).
  controllerLinkRange: 1
} as const;

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";
const CONTAINER: BuildableStructureConstant = "container";
const LINK: BuildableStructureConstant = "link";

function wantedPreStorageUpgraders(colony: ColonySnapshot): number {
  // Only worth spawning once there's energy to draw from (container, drop, or storage/link).
  const standingDrop = colony.drops.reduce((sum, d) => sum + d.amount, 0);
  const containerEnergy = colony.containers.reduce((sum, c) => sum + c.storeEnergy, 0);
  if (standingDrop + containerEnergy <= 0) return 0;

  // Hold at the floor while construction is outstanding: extensions win the energy competition.
  if (colony.constructionProgress > 0) return upgraderConfig.minPreStorageUpgraders;

  // Nothing left to build: absorb the surplus, uncapped (arbiter's affordability guard is the real limit).
  const base = Math.max(upgraderConfig.minPreStorageUpgraders, colony.sources.length);
  const surplusBonus = Math.ceil((standingDrop + containerEnergy) / upgraderConfig.surplusPerUpgrader);
  return base + surplusBonus;
}

function upgraderBodyWork(colony: ColonySnapshot): number {
  const body = roleDef("upgrader")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

/**
 * Pre-storage upgrader headcount ceiling from income. upgrade() costs 1 e/tick per WORK, so the whole
 * income could feed upgrading — but building wins the competition: while a backlog exists builders take
 * up to sustainableBuildWork * 5 e/t (the full income at low RCL), leaving upgraders only the remainder
 * at 1 e/t per WORK. Once construction is done the remainder is the whole income again. Translated into
 * a headcount against the current body's WORK, so the cap tracks body size like Building's does.
 */
function incomeCappedUpgraders(colony: ColonySnapshot): number {
  const buildSpend = colony.constructionProgress > 0 ? sustainableBuildWork(colony) * 5 : 0;
  const upgradeBudgetWork = Math.max(0, incomePerTick(colony) - buildSpend); // 1 e/t per WORK
  return Math.floor(upgradeBudgetWork / upgraderBodyWork(colony));
}

function wantedUpgraders(colony: ColonySnapshot): number {
  // With storage, scale with what it holds — the buffer, not income, is the constraint.
  if (colony.storageEnergy > 0) {
    const wanted = Math.min(
      upgraderConfig.maxStorageUpgraders,
      Math.max(0, Math.floor((colony.storageEnergy - upgraderConfig.storageReserve) / upgraderConfig.storagePerUpgrader))
    );
    return Math.min(upgraderConfig.maxUpgraders, wanted);
  }

  // Pre-storage: the demand-side count (surplus/backlog driven) capped by what income can sustainably
  // feed, since there's no buffer to draw down. The floor (minPreStorageUpgraders while building) still
  // applies via wantedPreStorageUpgraders — a lone floor upgrader is cheap enough to run off the buffer
  // haulers keep in the containers even when the strict income remainder rounds to zero.
  const demand = wantedPreStorageUpgraders(colony);
  const capped = Math.min(demand, incomeCappedUpgraders(colony));
  const floored = colony.constructionProgress > 0 ? Math.max(capped, Math.min(demand, upgraderConfig.minPreStorageUpgraders)) : capped;
  return Math.min(upgraderConfig.maxUpgraders, floored);
}

// The tile storage sits on in the bunker goal — known from the anchor before storage is built, so the
// container's road can aim at where storage will be.
function storageTile(anchor: XY): XY | null {
  const storage = GOAL.placements.find(p => p.type === "storage");
  if (!storage) return null;
  return { x: storage.x + anchor.x, y: storage.y + anchor.y };
}

export class Upgrading extends Operation {
  public readonly kind = "upgrading";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.fillRole(colony, "upgrader", wantedUpgraders(colony), roleDef("upgrader")!.priority);
  }

  /** Report the true upgrader target (it falls as stored energy drops), so census shows any surplus as `N/0`. */
  public override roleTargets(colony: ColonySnapshot): RoleTarget[] {
    return [{ role: "upgrader", target: wantedUpgraders(colony) }];
  }

  /**
   * The controller container/link (within range 1 of the controller, so an upgrader standing on it
   * stays in upgrade range) and the road linking it to storage. Gated on energyCapacity, not RCL: 550
   * is RCL2 with all extensions, the point at which the room can spare the build. Below linkRcl (5,
   * when the first links unlock) this claims a container; at/above it, a link at the same spot instead
   * — same site the container would have sat on, same road in, but fed by transferEnergy rather than a
   * hauler once something sends to it. Claims only — never places sites.
   */
  public override structures(colony: ColonySnapshot, planned: readonly PlacedStructure[] = []): PlacedStructure[] {
    const route = this.route(colony, planned);
    if (!route) return [];

    // Only a DIFFERENT structure type on a tile blocks a claim here — a road this route's own path
    // shares with the bunker grid or (very often, since the same PathFinder `preferred`-tile bias steers
    // both toward one shared corridor — see remotePath.ts) a Mining remote-route road is agreement, not
    // a conflict, and must still go out as this operation's own claim. Dropping it silently meant
    // building.ts's gateRoads never saw it as "an operation's own claimed road" (its exemption from the
    // adjacency-to-a-served-structure gate), so a shared-corridor tile with nothing else served nearby
    // fell back to that gate and could fail it outright — the tile was already largely built for Mining's
    // own reasons, but that didn't stop THIS claim's absence from starving the genuine gaps in it of a
    // construction site. Confirmed live on W47N14 2026-08-13: the entire controller-approach road runs
    // along the same corridor Mining's W47N15 remote route uses, and every one of Upgrading's 16 road
    // claims for it were silently dropped — 13 of those tiles are genuinely unbuilt but never got sited.
    const takenType = new Map(planned.map(p => [`${p.x},${p.y}`, p.type]));
    const out: PlacedStructure[] = [];
    const claim = (p: PlacedStructure): void => {
      const key = `${p.x},${p.y}`;
      const existing = takenType.get(key);
      if (existing !== undefined && existing !== p.type) return;
      takenType.set(key, p.type);
      out.push(p);
    };

    const structureType = colony.controllerLevel >= upgraderConfig.linkRcl ? LINK : CONTAINER;
    claim({ x: route.structurePos.x, y: route.structurePos.y, type: structureType });
    // First tile is the storage side, last is the container/link — road covers everything between.
    for (const tile of route.path.slice(1, -1)) claim({ x: tile.x, y: tile.y, type: ROAD });
    return out;
  }

  /**
   * Persists the controller link's id once built — the equivalent of Mining's recordSourceSpot, for the
   * one link Mining doesn't own. Detected by proximity to the controller (any built link within range 2
   * that isn't already known to be the anchor link or a source link) rather than an exact match against
   * structures()' own A*-derived tile: a link built before the current pathing code, or one nudged aside
   * by a later road/obstacle change, can legitimately sit one tile off from where a fresh route would
   * land today — proximity is the same tolerance graph.ts's controller-container consumer check and
   * layouts/roads.ts's controllerContainerPath already use for "is this near enough to the controller."
   */
  public override intents(colony: ColonySnapshot): Intent[] {
    if (colony.controllerLevel < upgraderConfig.linkRcl) return [];
    // Re-detects rather than trusting the recorded id blindly: if that link was destroyed (combat,
    // manual removal), colony.links no longer contains it, and route()'s own live-link check below
    // would then treat the dead id as just another obstacle — silently re-siting a replacement next
    // to the old (now-empty) tile instead of rebuilding in place. Recording only ever *adds* an id
    // (recordLinkNetwork's own rule), so once a live replacement is found this fires again and wins.
    if (colony.linkNetwork.controller && colony.links.some(l => l.id === colony.linkNetwork.controller)) return [];

    const sourceLinkIds = new Set(
      Object.values(colony.sourceMemory)
        .map(m => m?.linkId)
        .filter((id): id is Id<StructureLink> => id !== undefined)
    );
    const link = colony.links.find(
      l =>
        l.id !== colony.linkNetwork.storage &&
        !sourceLinkIds.has(l.id) &&
        Math.max(Math.abs(l.x - colony.controller.x), Math.abs(l.y - colony.controller.y)) <= upgraderConfig.controllerLinkRange
    );
    if (!link) return [];

    return [{ kind: "recordLinkNetwork", room: colony.name, controller: link.id }];
  }

  /**
   * Shared route derivation so structures()'s claim and intents()'s built-link detection can never
   * disagree about where the controller container/link sits. Not cached (unlike Mining's sourceRoutes):
   * this A* runs at most once per tick per caller and Upgrading has only ever had the one route to find,
   * so the profiling case that justified Mining's module-scoped cache doesn't apply here yet.
   */
  private route(colony: ColonySnapshot, planned: readonly PlacedStructure[]): RoadPathResult | null {
    if (colony.energyCapacity < upgraderConfig.containerFromEnergyCapacity || !colony.anchor) return null;

    const from = storageTile(colony.anchor);
    if (!from) return null;

    // Path from the storage tile out to range 2 of the controller against the layout plus siblings'
    // claims, so a shared road is reused rather than duplicated (same reason Mining threads `planned`).
    // The already-built controller link is excluded from the obstacle list (unlike every other link,
    // which correctly blocks pathing): a link isn't in roads.ts's WALKABLE_STRUCTURES because it truly
    // isn't walkable, but leaving it as an obstacle here means the instant it's built, this search can no
    // longer land back on its own tile and instead finds a different tile adjacent to the controller —
    // claiming a second link next to the first, since nothing's built at the new spot yet.
    //
    // Detected the same way intents() detects it (any built link within range of the controller that
    // isn't the anchor/a source link) rather than trusting colony.linkNetwork.controller by id: that
    // field only gets *set* the tick intents() runs, which reads the same once-per-tick snapshot this
    // route() call does — so on the very tick the link first appears in colony.structures, the recorded
    // id is still stale/unset here even though the live link already exists. Falling back to id-only
    // would treat that brand-new link as an obstacle for one tick, re-site a replacement next to it, and
    // then raze the original as unwanted — the exact razed/rebuilt loop this route is trying to prevent.
    const sourceLinkIds = new Set(
      Object.values(colony.sourceMemory)
        .map(m => m?.linkId)
        .filter((id): id is Id<StructureLink> => id !== undefined)
    );
    const controllerLink = colony.links.find(
      l =>
        l.id !== colony.linkNetwork.storage &&
        !sourceLinkIds.has(l.id) &&
        Math.max(Math.abs(l.x - colony.controller.x), Math.abs(l.y - colony.controller.y)) <= upgraderConfig.controllerLinkRange
    );
    const structures = colony.structures.filter(s => s.id !== controllerLink?.id);
    const costMatrix = buildCostMatrix({
      terrain: colony.terrain,
      structures: [...structures, ...planned]
    });

    const taken = new Set(planned.map(p => `${p.x},${p.y}`));
    // The A* endpoint can land on a tile the bunker's own road grid already claims — cheap to path
    // through (ROAD_COST), so nothing steers the search away from ending there. A container can share
    // a tile with a road in Screeps, but the claim still needs to win that tile, and a link can't stack
    // with a road at all — so re-path with that endpoint blocked until landing on a tile nobody else
    // wants yet. Bounded: each retry permanently blocks one more tile, and the search area is finite.
    let route = controllerContainerPath(from, colony.controller, costMatrix);
    for (let guard = 0; guard < 8 && route.structurePos && taken.has(`${route.structurePos.x},${route.structurePos.y}`); guard++) {
      costMatrix.set(route.structurePos.x, route.structurePos.y, 255);
      route = controllerContainerPath(from, colony.controller, costMatrix);
    }
    if (!route.structurePos || taken.has(`${route.structurePos.x},${route.structurePos.y}`)) return null;
    return route;
  }
}
