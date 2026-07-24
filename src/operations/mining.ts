// Mining owns the source-to-storage capability end to end, not "the miner role": the miners, the
// haulers that carry what miners produce, and the per-source container/link they drop into.
// systems/logistics.ts was deleted for this — there was never a logistics capability, only a
// hauler role that belonged to mining all along.
//
// Pure — reads the snapshot, returns plain data, never touches Game.*/Memory.

import { countPart, orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import GOAL_JSON from "../layouts/Base_2.json";
import { plannedObstacles } from "../layouts/goal";
import { buildCostMatrix, sourceRoadPath, type RoadPathResult } from "../layouts/roads";
import { stampLayout, type PlacedStructure } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import { range, type XY } from "../lib/geometry";
import type { ColonySnapshot, SnapCreep, SnapSource } from "../snapshot/types";
import { DEFAULT_PRIORITY, fillTo, type CreepRequest } from "../spawn/request";
import { bodyContext } from "../behaviors/bodyContext";
import { Operation } from "./operation";

// Deliberately not gated on storage: the container-backed economy is what funds storage, so gating on it would deadlock the colony.
const MIN_CONTAINER_RCL = 2;
// A link beats a container from RCL7: the miner drops straight into the link network instead of needing a hauler round trip.
const LINK_RCL = 7;
// A container placed before miners exist is 5000 energy nobody can use, sitting in a scarce focus slot starving extensions.
// Moved here from building.ts: gating a source container on RCL is mining's knowledge of what it needs *when*.
export const CONTAINERS_FROM_RCL = 3;

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

const MIN_HAULER_ENERGY = 150; // one CARRY,CARRY,MOVE set — the cheapest body

// A source yields 10 energy/tick and one WORK harvests 2/tick (5 WORK is exact); the colony
// provisions slightly above that to cover the walk to the source and the gap between a miner
// dying and its replacement arriving.
const WORK_PER_SOURCE = 6;

// A WORK part harvests HARVEST_POWER (2) energy/tick; income is capped at what sources regenerate
// (two sources at 10/tick each) so a miner surplus can't make the colony ask for haulers to carry
// energy that isn't there.
const SOURCE_REGEN_PER_TICK = 10;
// One room's ceiling on harvestable income (matches the goal's "capped at 20 energy/tick"). Haulers
// scale with miner throughput up to this, never past it.
const ROOM_INCOME_CAP = 20;
// A hauler carries 50 energy per CARRY part — turns "carry capacity needed" into a headcount.
const ENERGY_PER_CARRY = 50;
// Fallback source→drop-off distance before an anchor is known (the very first ticks); self-corrects
// once one is cached.
const DEFAULT_HAUL_DISTANCE = 10;
// Safety rail on fleet size; the distance/income formula sizes the fleet under it. Measured: a larger
// fleet (9 haulers) doesn't clear the early-game drop backlog any better than 6 — pre-container the
// bottleneck is the colony's small sink, not carry capacity. The backlog clears at RCL3, when miners
// drop into containers that hold energy without it decaying.
const MAX_HAULERS = 6;

// Dropped energy the fleet is already behind on. Below this the pile is just normal in-flight energy
// between visits; above it, extra transport is fielded to clear it (legacy HaulerOperation's
// dropped-energy bump, whose threshold was a flat 2000).
const DROP_BACKLOG_THRESHOLD = 2000;

function sourceStructureType(rcl: number): BuildableStructureConstant {
  return rcl >= LINK_RCL ? "link" : "container";
}

/**
 * Rewrite miner/hauler priorities so the arbiter's flat sort *spawns* them in alternation — miner,
 * hauler, miner, hauler — rather than every wanted miner before the first hauler.
 *
 * Ranking this tick's requests by index alone deadlocks the cold start: each tick re-emits the whole
 * remaining deficit, so the first miner request is always top priority and miners win every spawn
 * until every source is full — but with no hauler to fill the spawn, energy only trickles back at
 * passive regen, so "every source full" never arrives. Measured: a room stuck at 5 miners, 0 haulers,
 * drops rotting, after 3000 ticks.
 *
 * The rank has to count creeps **already live**, not just this tick's requests: each request is
 * ranked by what number-in-its-role it would be (live count + position in the deficit), and the two
 * roles interleave on that global count:
 *
 *   the k-th miner  → DEFAULT_PRIORITY.miner - 2(k-1)     (95, 93, 91, …)
 *   the k-th hauler → DEFAULT_PRIORITY.miner - 2(k-1) - 1 (94, 92, 90, …)
 *
 * With one miner already alive, the next hauler (k=1 → 94) outranks the *second* miner (k=2 → 93), so
 * the arbiter spawns a hauler before piling on more miners. Priorities stay within the miner/hauler
 * band (absolute across the empire, PRD 0005 §3.5), clamped so a large fleet never descends into the
 * upgrader tier.
 */
function interleaveByPriority(
  miners: CreepRequest[],
  haulers: CreepRequest[],
  liveMiners: number,
  liveHaulers: number
): CreepRequest[] {
  const FLOOR = DEFAULT_PRIORITY.upgrader + 1; // never dip into the upgrader tier
  const rank = (roleIndex: number, offset: 0 | 1): number =>
    Math.max(FLOOR, DEFAULT_PRIORITY.miner - 2 * roleIndex - offset);

  const out: CreepRequest[] = [];
  // The k-th miner is ranked against the k-th hauler, where k counts from the live headcount.
  miners.forEach((m, i) => out.push({ ...m, priority: rank(liveMiners + i, 0) }));
  haulers.forEach((h, i) => out.push({ ...h, priority: rank(liveHaulers + i, 1) }));
  return out;
}

// Asks the role table rather than restating its formula, so the quota tracks any change to the miner
// body automatically. Sized against the same context the request body uses: asking with a hardcoded
// {hasContainer:false} while spawning a container-shaped body makes the per-source target disagree
// with the creeps that fill it (a container miner carries up to 5 WORK, a drop miner 2).
function minerBodyWork(colony: ColonySnapshot): number {
  const body = roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

// Live WORK a miner contributes right now (spawning included — its parts already exist).
const workOf = (c: SnapCreep): number => countPart(c.body, WORK);

export class Mining extends Operation {
  public readonly kind = "mining";

  /**
   * Miners and haulers, interleaved by priority so the arbiter *spawns* them miner, hauler, miner,
   * hauler — not every miner first (see interleaveByPriority). "Miners first, then a hauler" and "no
   * haulers without miners" both hold: the first miner outranks the first hauler, and hauler demand
   * is zero until a live miner is producing (`haulerRequests`), so the very first spawn is a miner.
   */
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return interleaveByPriority(
      this.minerRequests(colony),
      this.haulerRequests(colony),
      this.owned(colony, "miner").length,
      this.owned(colony, "hauler").length
    );
  }

  /**
   * Requests to bring each source up to its **WORK target**, sized in WORK parts rather than a miner
   * headcount: the deficit is WORK_PER_SOURCE minus the WORK already assigned, filled by however many
   * of the current body size it takes. Counting WORK not heads is the fix for the miner swarm — a
   * headcount target can't see that three 2-WORK miners already saturate a source, so as bodies grew
   * it kept fielding more (nine 3-WORK miners, 27 WORK, on two sources that only ever needed ~12).
   *
   * The per-source deficit (rather than a colony total) catches the case a colony-wide number can't:
   * one source double-staffed, one bare. Clamped by open tiles so an enclosed source never asks for
   * more miners than can physically stand on it.
   *
   * Miners are sized against the source alone, with no hauler-count ceiling — hauler demand *derives
   * from* miner output (`haulerRequests`), so making miners wait on haulers that wait on miners would
   * deadlock the cold start. "Miners first, then a hauler" falls out directly: a bare source asks at
   * priority 95, and only once that miner is producing does `haulerRequests` size a hauler at 90.
   */
  private minerRequests(colony: ColonySnapshot): CreepRequest[] {
    const bodyWork = minerBodyWork(colony);
    // This operation's miners, not the colony's: a second Mining/RemoteMining must not count these.
    const miners = this.owned(colony, "miner");

    // Miners that predate stage 2 carry no sourceId (PRD §6 — cleared by attrition, not migration).
    // They still mine, so treat them as a queue of generic cover spread across sources: counting a
    // bare source as bare when an unassigned miner sits on it would over-ask. Each is borrowed by at
    // most one source, contributing both its WORK (toward the target) and its head (tile safeguard).
    const unassigned = miners.filter(c => c.memory.sourceId === undefined);
    let next = 0; // index of the first not-yet-borrowed miner

    const body = orderBody(roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    const out: CreepRequest[] = [];
    for (const source of colony.sources) {
      // WORK the source wants — a flat target; openTiles is a *headcount* safeguard (no more miners
      // than can physically reach the source at once), not a cap on WORK itself.
      const wantedWork = WORK_PER_SOURCE;
      const onSource = miners.filter(c => c.memory.sourceId === source.id);
      const assignedWork = onSource.reduce((s, c) => s + workOf(c), 0);
      // Draw on the unassigned pool before asking for a new creep — it's WORK already paid for.
      // Borrow whole miners off the queue: enough to cover the gap, each also occupying a tile.
      const workGap = Math.max(0, wantedWork - assignedWork);
      let borrowedWork = 0;
      let borrowedHeads = 0;
      while (next < unassigned.length && borrowedWork < workGap) {
        borrowedWork += workOf(unassigned[next]);
        borrowedHeads++;
        next++;
      }

      // One request per body needed to cover the remaining WORK deficit, clamped by the tiles still
      // free after the miners already standing on the source — never overshoots into a swarm.
      const deficit = workGap - borrowedWork;
      const freeTiles = Math.max(0, source.openTiles - onSource.length - borrowedHeads);
      const wantedBodies = Math.min(freeTiles, Math.ceil(deficit / bodyWork));
      for (let i = 0; i < wantedBodies; i++) {
        out.push({
          body,
          priority: DEFAULT_PRIORITY.miner,
          memory: {
            role: "miner",
            home: colony.name,
            op: this.name,
            sourceId: source.id
          },
          // Home mining wants its miner in its own room. Remote mining will differ — the seam is here.
          targetRoom: colony.name
        });
      }
    }
    return out;
  }

  /**
   * Haulers sized against what the miners actually produce, not a flat one-per-container count: the
   * old quota couldn't tell a source 5 tiles from the drop-off from one 25 tiles away, and never
   * spawned a hauler before a container existed, stalling RCL1 drop-mining with energy rotting on
   * the ground.
   *
   * Formula: income (energy/tick from live miner WORK, capped at the room's regen) × round trip
   * (2 × source→drop-off distance) is the carry capacity that accumulates between a hauler's visits;
   * divide by one hauler's capacity for the headcount. So carry scales with both miner output and
   * distance.
   *
   * "No haulers without miners" is structural: income is 0 with no producing miners, so target is 0.
   * "Miners first" follows from priority alone (90 vs 95).
   */
  private haulerRequests(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < MIN_HAULER_ENERGY) return [];

    // Sizing (wantedHaulers) needs the body's CARRY count, so it's computed here rather than inside
    // fillRole — the one case where the shared helper's internal body derivation isn't reusable.
    const body = orderBody(roleDef("hauler")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    const wanted = this.wantedHaulers(colony, body);
    return fillTo(wanted, this.owned(colony, "hauler").length, body, DEFAULT_PRIORITY.hauler, {
      role: "hauler",
      home: colony.name,
      op: this.name
    });
  }

  /**
   * How many haulers the miners' current output warrants. Zero with no producing miners; otherwise
   * at least one, capped at MAX_HAULERS. Two terms of carry capacity feed the count: the steady-state
   * pile income accumulates between visits, plus any backlog of dropped energy the fleet is already
   * behind on (ported from legacy's HaulerOperation). Both gated on a producing miner — a backlog
   * with no miner is a leftover, not a reason to spawn transport.
   */
  private wantedHaulers(colony: ColonySnapshot, body: BodyPartConstant[]): number {
    const income = this.harvestIncome(colony);
    if (income <= 0) return 0;

    const roundTrip = 2 * this.haulDistance(colony);
    const neededCarry = income * roundTrip + this.backlogCarry(colony);
    const perHauler = Math.max(1, countPart(body, CARRY)) * ENERGY_PER_CARRY;

    return Math.min(MAX_HAULERS, Math.max(1, Math.ceil(neededCarry / perHauler)));
  }

  /**
   * Carry capacity owed to a backlog of dropped energy — zero below DROP_BACKLOG_THRESHOLD (the
   * normal in-flight amount between visits), else the whole pile, so the fleet scales with how far
   * behind it is.
   */
  private backlogCarry(colony: ColonySnapshot): number {
    const dropped = colony.drops.reduce((sum: number, d) => sum + d.amount, 0);
    return dropped > DROP_BACKLOG_THRESHOLD ? dropped : 0;
  }

  /**
   * Harvestable income right now: live miners' WORK converted to energy/tick, clamped to what the
   * room's sources can regenerate. Only this operation's miners count — a sibling's miners feed a
   * sibling's haulers. A still-spawning miner already carries its parts, so it counts too.
   */
  private harvestIncome(colony: ColonySnapshot): number {
    const workParts = this.owned(colony, "miner").reduce(
      (sum: number, c: SnapCreep) => sum + countPart(c.body, WORK),
      0
    );
    const raw = workParts * HARVEST_POWER;
    const regenCap = Math.min(ROOM_INCOME_CAP, colony.sources.length * SOURCE_REGEN_PER_TICK);
    return Math.min(raw, regenCap);
  }

  /**
   * Mean distance a hauler travels from a source drop-off to where it unloads (storage, else the
   * anchor), falling back to a flat default before an anchor is known. Chebyshev range is a cheap
   * proxy for path length — good enough to size a fleet, at no pathfinding cost.
   */
  private haulDistance(colony: ColonySnapshot): number {
    const dropOff = this.dropOff(colony);
    if (!dropOff || colony.sources.length === 0) return DEFAULT_HAUL_DISTANCE;

    const total = colony.sources.reduce((sum: number, source: SnapSource) => {
      const spot = colony.sourceMemory[source.id]?.spot ?? source;
      return sum + range(dropOff, spot);
    }, 0);
    return Math.max(1, Math.round(total / colony.sources.length));
  }

  /** Where haulers deliver: storage if built, else the anchor. Null before either exists. */
  private dropOff(colony: ColonySnapshot): XY | null {
    if (colony.storageId) {
      const storage = colony.structures.find(s => s.type === "storage");
      if (storage) return { x: storage.x, y: storage.y };
    }
    return colony.anchor;
  }

  /**
   * Each source's container/link **and the road that reaches it**. Mining never places sites itself
   * — planBuilding owns construction and merges this with the room's layout.
   *
   * The road is Mining's to claim: the container only matters if haulers can reach it, and
   * `sourceRoadPath` computes the whole route anyway to find where the container goes.
   */
  public override structures(colony: ColonySnapshot, planned: readonly PlacedStructure[] = []): PlacedStructure[] {
    if (colony.controllerLevel < MIN_CONTAINER_RCL) return [];

    const type = sourceStructureType(colony.controllerLevel);
    // The RCL gate that lived in building.ts: an operation that cannot afford a container does not
    // ask for one, exactly as desiredCreeps() is gated by current state.
    if (type === "container" && colony.controllerLevel < CONTAINERS_FROM_RCL) return [];

    const out: PlacedStructure[] = [];
    // Tiles already spoken for — by the layout, a sibling operation, or Mining's own earlier sources
    // in this loop — so planBuilding never places two structures on one square. Built structures are
    // deliberately **not** in this set: a claim states what should exist, not a request to place a
    // site, and dropping it once built would make Mining demolish its own container the tick after
    // it went up.
    const taken = new Set(planned.map(p => `${p.x},${p.y}`));
    const claim = (p: PlacedStructure): void => {
      const key = `${p.x},${p.y}`;
      if (taken.has(key)) return;
      taken.add(key);
      out.push(p);
    };

    for (const [, route] of this.sourceRoutes(colony, planned)) {
      claim({ x: route.structurePos.x, y: route.structurePos.y, type });
      // The last tile is where the container goes, and the first is the anchor itself — neither is road.
      for (const tile of route.path.slice(0, -1)) claim({ x: tile.x, y: tile.y, type: ROAD });
    }
    return out;
  }

  /**
   * Source-spot bookkeeping, so roles avoid re-pathing every tick. Emitted **only when the write
   * would change something** — this channel runs every tick, so rewriting identical values
   * unconditionally (harmless when sampled every 50th tick) would be pure waste at 1/1.
   */
  public override intents(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = [];
    // The same baseline building.ts seeds its poll with, so the spot recorded here is the spot that
    // actually gets built. Derived rather than passed: this channel isn't arbitrated, so there's no
    // poll to hand it in.
    const planned = colony.anchor
      ? stampLayout(plannedObstacles(GOAL, colony.controllerLevel, colony.anchor, colony.sources), colony.anchor)
      : [];

    for (const [source, route] of this.sourceRoutes(colony, planned)) {
      const spot = route.structurePos;
      // Direct id handle so roles avoid scanning the room every tick.
      const container = colony.containers.find(c => c.x === spot.x && c.y === spot.y);
      const recorded = colony.sourceMemory[source.id];

      const spotUnchanged = recorded?.spot?.x === spot.x && recorded?.spot?.y === spot.y;
      // execute.ts only ever *adds* an id, so a write is needed only when there is a new one to add.
      const containerUnchanged = !container || recorded?.containerId === container.id;
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

  /**
   * The shared derivation every channel reads, so the recorded spot can never disagree with the
   * built spot. Pathed against built **and planned** structures — built-only was a latent bug: the
   * route ran through ground the layout will occupy, shifting the container position the tick that
   * structure went up, which then made planBuilding demolish and re-place it forever.
   */
  private sourceRoutes(
    colony: ColonySnapshot,
    planned: readonly PlacedStructure[]
  ): Map<SnapSource, RoadPathResult> {
    const out = new Map<SnapSource, RoadPathResult>();
    const anchor = colony.anchor;
    if (!anchor) return out;

    // buildCostMatrix treats containers, roads and ramparts as walkable, so neither a built container
    // nor a planned road deflects the path off the declared spot — a planned road is *preferred*,
    // which is what makes two operations share one route rather than lay parallel ones.
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
