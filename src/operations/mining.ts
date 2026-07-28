// Mining owns the source-to-storage capability end to end: miners, the haulers that carry what
// miners produce, and the per-source container/link they drop into. Pure — reads the snapshot only.

import { countPart, orderBody } from "../spawn/body";
import { roleDef } from "../behaviors/roles";
import { SOURCE_SATURATING_WORK } from "../behaviors/roles/miner";
import type { Intent } from "../intents/types";
import GOAL_JSON from "../layouts/Base_2.json";
import { plannedObstacles } from "../layouts/goal";
import { buildCostMatrix, sourceRoadPath, type RoadPathResult } from "../layouts/roads";
import { stampLayout, type PlacedStructure } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import { harvestIncome, haulDistance, interleaveRank } from "../logistics/fleet";
import type { ColonySnapshot, SnapCreep, SnapSource } from "../snapshot/types";
import { fillTo, type CreepRequest } from "../spawn/request";
import { bodyContext } from "../spawn/bodyContext";
import { Operation } from "./operation";

const config = {
  // A container/road claim waits on energy capacity, not RCL: RCL2 + all five extensions = 550.
  // Capacity, not level, is what proves the extension economy exists to fund the container.
  structuresFromEnergyCapacity: 800,
  linkRcl: 7, // link beats container: miner drops straight in, no hauler round trip
  minHaulerEnergy: 150, // one CARRY,CARRY,MOVE set — cheapest body
  workPerSource: SOURCE_SATURATING_WORK, // shared with miner.ts's body cap so the two can't drift apart
  sourceRegenPerTick: 10, // caps income so surplus miners can't ask for haulers to carry nonexistent energy
  roomIncomeCap: 20, // room ceiling on harvestable income (two sources)
  energyPerCarry: 50, // one CARRY part
  haulerCarryMargin: 1.1, // over-provision required carry by 10%: covers respawn gaps and en-route drops
  defaultHaulDistance: 10, // fallback before an anchor is known
  // 0: Logistics/transport now covers the source->spawn/extension leg (docs/logistics-plan.md step 7).
  // interleaveByPriority still runs over an empty haulers array — no special-casing needed. Existing
  // haulers age out naturally with no replacements.
  maxHaulers: 0,
  dropBacklogThreshold: 2000 // above this, extra transport is fielded to clear the pile
} as const;

// building.ts's gate on source containers is mining's knowledge of what it needs when.
export const CONTAINERS_FROM_ENERGY_CAPACITY = config.structuresFromEnergyCapacity;

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

function sourceStructureType(rcl: number): BuildableStructureConstant {
  return rcl >= config.linkRcl ? "link" : "container";
}

/**
 * Rewrite miner/hauler priorities so the arbiter spawns them interleaved (miner, hauler, miner,
 * hauler) instead of every wanted miner before the first hauler, which deadlocks the cold start.
 * haulers is always [] under maxHaulers:0 (docs/logistics-plan.md step 7) — this loop simply never
 * emits anything for that side, no special-casing needed.
 */
function interleaveByPriority(
  miners: CreepRequest[],
  haulers: CreepRequest[],
  liveMiners: number,
  liveHaulers: number
): CreepRequest[] {
  const minerPriority = roleDef("miner")!.priority;
  const floor = roleDef("upgrader")!.priority + 1; // never dip into the upgrader tier

  const out: CreepRequest[] = [];
  miners.forEach((m, i) => out.push({ ...m, priority: interleaveRank(minerPriority, floor, liveMiners + i, 0) }));
  haulers.forEach((h, i) => out.push({ ...h, priority: interleaveRank(minerPriority, floor, liveHaulers + i, 1) }));
  return out;
}

// Asks the role table rather than restating its formula, sized against the same context the request body uses.
function minerBodyWork(colony: ColonySnapshot): number {
  const body = roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

const workOf = (c: SnapCreep): number => countPart(c.body, WORK); // live WORK, spawning included

export class Mining extends Operation {
  public readonly kind = "mining";

  /** Miners and haulers, interleaved by priority so the arbiter spawns them in alternation. */
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return interleaveByPriority(
      this.minerRequests(colony),
      this.haulerRequests(colony),
      this.owned(colony, "miner").length,
      this.owned(colony, "hauler").length
    );
  }

  /**
   * Bring each source up to its WORK target (not a headcount), clamped by open tiles. Per-source
   * rather than colony-total so one double-staffed, one bare source can't average out.
   */
  private minerRequests(colony: ColonySnapshot): CreepRequest[] {
    const bodyWork = minerBodyWork(colony);
    const miners = this.owned(colony, "miner"); // this operation's only — a sibling must not count these

    // Miners predating stage 2 carry no sourceId (PRD §6). Treat as generic cover: borrowed by at
    // most one source, contributing both WORK (toward target) and head (tile safeguard).
    const unassigned = miners.filter(c => c.memory.sourceId === undefined);
    let next = 0; // index of the first not-yet-borrowed miner

    const body = orderBody(roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    const out: CreepRequest[] = [];
    for (const source of colony.sources) {
      const wantedWork = config.workPerSource;
      const onSource = miners.filter(c => c.memory.sourceId === source.id);
      const assignedWork = onSource.reduce((s, c) => s + workOf(c), 0);
      // Draw on the unassigned pool before asking for a new creep — WORK already paid for.
      const workGap = Math.max(0, wantedWork - assignedWork);
      let borrowedWork = 0;
      let borrowedHeads = 0;
      while (next < unassigned.length && borrowedWork < workGap) {
        borrowedWork += workOf(unassigned[next]);
        borrowedHeads++;
        next++;
      }

      const deficit = workGap - borrowedWork;
      const freeTiles = Math.max(0, source.openTiles - onSource.length - borrowedHeads);
      const wantedBodies = Math.min(freeTiles, Math.ceil(deficit / bodyWork));
      for (let i = 0; i < wantedBodies; i++) {
        out.push({
          body,
          priority: roleDef("miner")!.priority,
          memory: {
            role: "miner",
            home: colony.name,
            op: this.name,
            sourceId: source.id
          },
          targetRoom: colony.name // remote mining will differ — the seam is here
        });
      }
    }
    return out;
  }

  /**
   * Haulers sized against what miners actually produce (income × round trip), not a flat
   * one-per-container count. Zero when no miners are producing.
   */
  private haulerRequests(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < config.minHaulerEnergy) return [];

    const body = orderBody(roleDef("hauler")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    const wanted = this.wantedHaulers(colony, body);
    return fillTo(wanted, this.owned(colony, "hauler").length, body, roleDef("hauler")!.priority, {
      role: "hauler",
      home: colony.name,
      op: this.name
    });
  }

  /** How many haulers current miner output warrants: steady-state pile + any drop backlog, capped. */
  private wantedHaulers(colony: ColonySnapshot, body: BodyPartConstant[]): number {
    const income = harvestIncome(this.owned(colony, "miner"), colony, config);
    if (income <= 0) return 0;

    const roundTrip = 2 * haulDistance(colony, config);
    // Over-provision carry (round up): the exact steady-state figure runs too lean once respawn
    // gaps and en-route drops are accounted for, so buy a margin (config.haulerCarryMargin).
    const neededCarry = Math.ceil((income * roundTrip + this.backlogCarry(colony)) * config.haulerCarryMargin);
    const perHauler = Math.max(1, countPart(body, CARRY)) * config.energyPerCarry;

    return Math.min(config.maxHaulers, Math.max(1, Math.ceil(neededCarry / perHauler)));
  }

  /** Carry owed to a dropped-energy backlog — zero below threshold, else the whole pile. */
  private backlogCarry(colony: ColonySnapshot): number {
    const dropped = colony.drops.reduce((sum: number, d) => sum + d.amount, 0);
    return dropped > config.dropBacklogThreshold ? dropped : 0;
  }

  /** Each source's container/link and the road that reaches it. Never places sites — only claims. */
  public override structures(colony: ColonySnapshot, planned: readonly PlacedStructure[] = []): PlacedStructure[] {
    if (colony.energyCapacity < config.structuresFromEnergyCapacity) return [];

    const type = sourceStructureType(colony.controllerLevel);

    const out: PlacedStructure[] = [];
    // Tiles already claimed by layout, a sibling, or an earlier source this loop. Built structures
    // are deliberately excluded — a claim isn't "place a site," so dropping it once built would make
    // Mining demolish its own container the tick after it went up.
    const taken = new Set(planned.map(p => `${p.x},${p.y}`));
    const claim = (p: PlacedStructure): void => {
      const key = `${p.x},${p.y}`;
      if (taken.has(key)) return;
      taken.add(key);
      out.push(p);
    };

    for (const [, route] of this.sourceRoutes(colony, planned)) {
      claim({ x: route.structurePos.x, y: route.structurePos.y, type });
      for (const tile of route.path.slice(0, -1)) claim({ x: tile.x, y: tile.y, type: ROAD }); // last tile is the container, first is the anchor
    }
    return out;
  }

  /** Source-spot bookkeeping so roles skip re-pathing. Emitted only when the write would change something. */
  public override intents(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = [];
    const planned = colony.anchor
      ? stampLayout(plannedObstacles(GOAL, colony.controllerLevel, colony.anchor, colony.sources), colony.anchor)
      : [];

    for (const [source, route] of this.sourceRoutes(colony, planned)) {
      const spot = route.structurePos;
      const container = colony.containers.find(c => c.x === spot.x && c.y === spot.y);
      const recorded = colony.sourceMemory[source.id];

      const spotUnchanged = recorded?.spot?.x === spot.x && recorded?.spot?.y === spot.y;
      const containerUnchanged = !container || recorded?.containerId === container.id; // execute.ts only ever adds an id
      if (spotUnchanged && containerUnchanged) continue;

      out.push({
        kind: "recordSourceSpot",
        room: colony.name,
        source: source.id,
        spot: { x: spot.x, y: spot.y },
        ...(container ? { container: container.id } : {})
      });
    }
    return out;
  }

  /** Shared route derivation so the recorded spot can never disagree with the built spot. */
  private sourceRoutes(
    colony: ColonySnapshot,
    planned: readonly PlacedStructure[]
  ): Map<SnapSource, RoadPathResult> {
    const out = new Map<SnapSource, RoadPathResult>();
    const anchor = colony.anchor;
    if (!anchor) return out;

    // Containers/roads/ramparts are walkable, so a planned road is preferred — the reason two
    // operations share one route instead of laying parallel ones.
    const costMatrix = buildCostMatrix({
      terrain: colony.terrain,
      structures: [...colony.structures, ...planned]
    });

    for (const source of colony.sources) {
      const route = sourceRoadPath(anchor, source, costMatrix);
      if (route.structurePos) out.set(source, route);
    }
    return out;
  }
}
