// Upgrading owns the upgrader workforce and its infrastructure: how many upgraders given stored
// energy, plus the controller container/road that keeps them fed without a hauler round trip. Pure.

import { roleDef } from "../behaviors/roles";
import { bodyContext } from "../spawn/bodyContext";
import { countPart } from "../spawn/body";
import GOAL_JSON from "../construction/Base_2.json";
import type { FindPath } from "../construction/planner";
import type { PlacedStructure } from "../construction/stamp";
import type { GoalLayout } from "../construction/sync";
import type { Intent } from "../intents/types";
import type { XY } from "../lib/geometry";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { incomePerTick, sustainableBuildWork } from "./construction";
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
  // Same range structures()' own findPath call targets (UPGRADE_CONTAINER_RANGE below) and graph.ts's
  // controller-container consumer check — kept as its own constant here since intents() below detects
  // the built link by proximity, not by matching structures()' exact A*-derived tile (see the
  // controller-link detection doc comment on intents()).
  controllerLinkRange: 1
} as const;

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";
const CONTAINER: BuildableStructureConstant = "container";
const LINK: BuildableStructureConstant = "link";
// The upgrade container sits adjacent to the controller (range 1, not the full range-3 upgrade range)
// so an upgrader standing on it is still in range of the controller with room to spare.
const UPGRADE_CONTAINER_RANGE = 1;

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

// The already-built controller container/link, if one exists — same proximity detection intents() uses
// for the link (any link within range that isn't the anchor/storage link or a source link), extended to
// containers so structures() can pin its claim there below linkRcl too. Checked every call rather than
// cached: colony.containers/colony.links are already this tick's live snapshot arrays, cheap to scan.
function findBuiltControllerStructure(colony: ColonySnapshot): XY | null {
  const sourceLinkIds = new Set(
    Object.values(colony.sourceMemory)
      .map(m => m?.linkId)
      .filter((id): id is Id<StructureLink> => id !== undefined)
  );
  const nearController = (p: XY) =>
    Math.max(Math.abs(p.x - colony.controller.x), Math.abs(p.y - colony.controller.y)) <= upgraderConfig.controllerLinkRange;
  const link = colony.links.find(
    l => l.id !== colony.linkNetwork.storage && !sourceLinkIds.has(l.id) && nearController(l)
  );
  if (link) return { x: link.x, y: link.y };
  const container = colony.containers.find(nearController);
  return container ? { x: container.x, y: container.y } : null;
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
   *
   * Once a container/link is already built near the controller (detected the same proximity way
   * intents() does), the claim is PINNED to that exact tile rather than re-run through findPath's own
   * endpoint search: findPath's matrix is seeded fresh every claimsOf pass from terrain + bunker layout +
   * whatever operations ahead of this one (Mining, in operationsFor's order) staged this tick — a set
   * that legitimately varies tick to tick (remote selection churn, a newly built road). With many
   * equal-cost goal tiles available in clearBunkerFootprint's goal set, that variation can tip
   * PathFinder's own tie-break to a DIFFERENT tile than the one actually built, which then reads as a
   * second container/link claim (the old one goes stale/demolished, a new site opens elsewhere) — the
   * same relocation bug the pre-refactor route() avoided by excluding the live link from its obstacle
   * set so the search could only ever re-land on its own tile. Pinning the goal tile directly is a
   * stronger fix than restoring an exclusion: it never re-derives an endpoint at all once one exists,
   * so no tie-break can ever move it — only the road claim (findPath's own path result INTO that tile)
   * still comes from a fresh search each pass, since a road has no such stability requirement.
   */
  public override structures(colony: ColonySnapshot, findPath: FindPath): PlacedStructure[] {
    if (colony.energyCapacity < upgraderConfig.containerFromEnergyCapacity || !colony.anchor) return [];
    const from = storageTile(colony.anchor);
    if (!from) return [];
    const fromPos = new RoomPosition(from.x, from.y, colony.name);

    const structureType = colony.controllerLevel >= upgraderConfig.linkRcl ? LINK : CONTAINER;
    const built = findBuiltControllerStructure(colony);
    const toPos = built
      ? new RoomPosition(built.x, built.y, colony.name)
      : new RoomPosition(colony.controller.x, colony.controller.y, colony.name);
    const range = built ? 0 : UPGRADE_CONTAINER_RANGE;
    const opts = built ? undefined : { clearBunkerFootprint: true };

    const route = findPath(fromPos, toPos, range, opts);
    if (route.path.length === 0) return []; // no path found; findPath already logged

    const structurePos = built ?? route.structurePos;
    const out: PlacedStructure[] = [{ x: structurePos.x, y: structurePos.y, type: structureType }];
    // route.path is the real PathFinder.search result: every step AFTER `from` (storage), never
    // including `from` itself — so the last entry is the container/link and everything before it is
    // road; there is no leading origin tile to also drop (unlike the old hand-rolled A*, which
    // included `from` as path[0]).
    for (const tile of route.path.slice(0, -1)) out.push({ x: tile.x, y: tile.y, type: ROAD });
    return out;
  }

  /**
   * Persists the controller link's id once built — the equivalent of Mining's recordSourceSpot, for the
   * one link Mining doesn't own. Detected by proximity to the controller (any built link within range 2
   * that isn't already known to be the anchor link or a source link) rather than an exact match against
   * structures()' own findPath-derived tile: a link built before the current pathing code, or one nudged
   * aside by a later road/obstacle change, can legitimately sit one tile off from where a fresh route
   * would land today — proximity is the same tolerance graph.ts's controller-container consumer check uses.
   */
  public override intents(colony: ColonySnapshot): Intent[] {
    if (colony.controllerLevel < upgraderConfig.linkRcl) return [];
    // Re-detects rather than trusting the recorded id blindly: if that link was destroyed (combat,
    // manual removal), colony.links no longer contains it — silently re-siting a replacement next
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
}
