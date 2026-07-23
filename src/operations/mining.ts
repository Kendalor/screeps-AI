// Mining owns the source-to-storage capability end to end, not "the miner role": the miners, the
// haulers that carry what miners produce, and the per-source container/link they drop into.
// systems/logistics.ts was deleted for this — there was never a logistics capability, there was a
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

// A WORK part harvests HARVEST_POWER (2) energy/tick. The room's whole harvestable income is capped
// at what its sources regenerate — two sources at 10/tick each — so a miner surplus can never make
// the colony ask for haulers to carry energy that isn't there.
const SOURCE_REGEN_PER_TICK = 10;
// One room's ceiling on harvestable income, stated for the hauler sizing: at most two sources ×
// 10/tick. Haulers scale with miner throughput *up to* this, never past it. Matches the goal's
// "capped at 20 energy/tick" for a single room.
const ROOM_INCOME_CAP = 20;
// A hauler carries 50 energy per CARRY part. Used to turn "carry capacity needed" into a headcount.
const ENERGY_PER_CARRY = 50;
// Fallback source→drop-off distance when no anchor is known yet (the very first ticks). One hauler
// covers a short opening trip; the estimate self-corrects the moment an anchor is cached.
const DEFAULT_HAUL_DISTANCE = 10;
// The empire never fields fewer than one hauler once a miner is producing, nor an unbounded swarm.
// The upper bound is a safety rail; the distance/income formula almost always lands well under it.
const MAX_HAULERS = 6;

function sourceStructureType(rcl: number): BuildableStructureConstant {
  return rcl >= LINK_RCL ? "link" : "container";
}

/**
 * Rewrite miner/hauler priorities so the arbiter's flat sort spawns them in alternation — miner,
 * hauler, miner, hauler — rather than draining the spawn budget on every miner before the first
 * hauler. Pair i puts the miner one step above its hauler, and each pair one step below the last:
 *
 *   miners:  95, 93, 91, ...   (DEFAULT_PRIORITY.miner - 2i)
 *   haulers: 94, 92, 90, ...   (one below the paired miner)
 *
 * A flat descending sort over the result yields m0, h0, m1, h1, …. When one list is longer, its
 * surplus simply continues the descent past the last pair — miners stay ahead, haulers stay behind.
 * The step never carries the sequence below the upgrader tier (60) for any realistic fleet: even six
 * pairs bottoms out at 84.
 *
 * Priorities are absolute across the empire (PRD 0005 §3.5), so this reshuffles only *within* the
 * miner/hauler band the two roles already occupied — it does not reorder them against other roles.
 */
function interleaveByPriority(miners: CreepRequest[], haulers: CreepRequest[]): CreepRequest[] {
  const out: CreepRequest[] = [];
  const pairs = Math.max(miners.length, haulers.length);
  for (let i = 0; i < pairs; i++) {
    const top = DEFAULT_PRIORITY.miner - 2 * i;
    if (i < miners.length) out.push({ ...miners[i], priority: top });
    if (i < haulers.length) out.push({ ...haulers[i], priority: top - 1 });
  }
  return out;
}

// Asks the role table rather than restating its formula, so the quota tracks any change to the miner
// body automatically. Sized against the same context the request body uses: asking with a hardcoded
// {hasContainer:false} while spawning a container-shaped body makes the per-source target disagree
// with the creeps that fill it (a container miner carries up to 5 WORK, a drop miner 2).
function minerWorkParts(colony: ColonySnapshot): number {
  const body = roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

export class Mining extends Operation {
  public readonly kind = "mining";

  /**
   * Miners and haulers, interleaved by priority so the arbiter spawns them miner, hauler, miner,
   * hauler — not every miner first. The arbiter sorts on a flat absolute priority, so alternation
   * has to be *encoded in the priorities themselves*: each miner sits one step above its paired
   * hauler, each pair one step below the last. That way a room never spends its whole spawn budget
   * standing up miners a lone hauler cannot keep drained, and it never over-provisions haulers ahead
   * of the miners whose output justifies them.
   *
   * "Miners first, then a hauler" and "no haulers without miners" both still hold: the miner in each
   * pair outranks its hauler, and hauler demand is zero until a live miner is producing
   * (`haulerRequests`), so the very first spawn is always a miner.
   */
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return interleaveByPriority(this.minerRequests(colony), this.haulerRequests(colony));
  }

  /**
   * One request per source that no live miner is assigned to. The per-source deficit replaces a
   * colony-wide count: with the same formula the two produce the same spawn sequence, and they
   * diverge only where the colony total is already wrong (one source double-staffed, one bare) —
   * a case a count cannot see.
   *
   * Miners lead the economy and are sized against the source alone (the per-source WORK target,
   * clamped by open tiles) — no hauler-count ceiling. The old ceiling coupled miner headcount to
   * live haulers, which is now backwards: hauler demand *derives from* miner output
   * (`haulerRequests`), so making miners wait on haulers that wait on miners would deadlock the
   * cold start. "Miners first, then a hauler" falls out of this directly — a source with no miner
   * asks for one at priority 95, and only once that miner is producing does `haulerRequests` see
   * the WORK to size a hauler at priority 90.
   */
  private minerRequests(colony: ColonySnapshot): CreepRequest[] {
    const workPerBody = minerWorkParts(colony);
    // This operation's miners, not the colony's: a second Mining/RemoteMining must not count these.
    const miners = this.owned(colony, "miner");

    // Per-source want, from the same formula the colony-wide count used.
    const perSource = (source: { openTiles: number }): number =>
      Math.min(Math.ceil(WORK_PER_SOURCE / workPerBody), source.openTiles);

    // Miners that predate stage 2 carry no sourceId (PRD §6 — cleared by attrition, not migration).
    // They still mine, so they are spread across the sources as generic cover rather than left to
    // look like they cover nothing: counting a bare source as bare when an unassigned miner is
    // sitting on it would make the colony ask for a second miner it does not need.
    let unassigned = miners.filter(c => c.memory.sourceId === undefined).length;

    const body = orderBody(roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    const out: CreepRequest[] = [];
    for (const source of colony.sources) {
      const wanted = perSource(source);
      const assigned = miners.filter(c => c.memory.sourceId === source.id).length;
      // Draw on the unassigned pool before asking for a new creep — an un-owned miner sitting on this
      // source is cover the colony already paid for.
      const borrowed = Math.min(unassigned, Math.max(0, wanted - assigned));
      unassigned -= borrowed;

      // One request per missing miner on this source, not one per source: a source wanting three
      // miners asks for three, exactly as the colony-wide count did.
      for (let i = assigned + borrowed; i < wanted; i++) {
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
   * Haulers sized against what the miners actually produce, not a flat one-per-container count. The
   * old quota (one hauler per filling container) could not tell a source 5 tiles from the drop-off
   * from one 25 tiles away, yet the far source needs several times the carry capacity to keep its
   * pile from decaying. It also never spawned a hauler before a *container* existed, so a room
   * drop-mining at RCL1 stalled with energy rotting on the ground.
   *
   * The formula: income (energy/tick, from live miner WORK, capped at the room's regen) times the
   * round trip (2 × source→drop-off distance) is the energy that accumulates at the source between
   * a hauler's visits — the carry capacity the fleet must field. Divide by one hauler's capacity for
   * the headcount. So a hauler's carry scales with miner capacity (more WORK ⇒ more income) and with
   * distance, exactly as the goal asks.
   *
   * "No haulers without miners" is structural: income is 0 with no producing miners, so the target
   * is 0. "Miners first, then a hauler" follows — the first miner produces before this asks for
   * the first hauler, and the hauler's lower priority (90 vs 95) keeps miners ahead when both are
   * short.
   */
  private haulerRequests(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < MIN_HAULER_ENERGY) return [];

    const body = orderBody(roleDef("hauler")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    const wanted = this.wantedHaulers(colony, body);
    return fillTo(
      wanted,
      this.owned(colony, "hauler").length,
      body,
      DEFAULT_PRIORITY.hauler,
      { role: "hauler", home: colony.name, op: this.name }
    );
  }

  /**
   * How many haulers the miners' current output warrants, given the trip they must run. Zero with
   * no producing miners; otherwise at least one, capped at MAX_HAULERS.
   */
  private wantedHaulers(colony: ColonySnapshot, body: BodyPartConstant[]): number {
    const income = this.harvestIncome(colony);
    if (income <= 0) return 0;

    const roundTrip = 2 * this.haulDistance(colony);
    const neededCarry = income * roundTrip;
    const perHauler = Math.max(1, countPart(body, CARRY)) * ENERGY_PER_CARRY;

    return Math.min(MAX_HAULERS, Math.max(1, Math.ceil(neededCarry / perHauler)));
  }

  /**
   * Harvestable income right now: the live miners' WORK, converted to energy/tick, clamped to what
   * the room's sources can actually regenerate. Only *this operation's* miners count — a sibling's
   * miners feed a sibling's haulers. A miner that is still spawning already carries its parts and is
   * about to produce, so it counts too (SnapCreep.body is live parts, spawning included).
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
   * Mean distance a hauler travels from a source drop-off back to where it unloads (storage, else
   * the anchor). Uses the recorded mining spot when there is one, falling back to the source tile,
   * and a flat default before an anchor is even known. Chebyshev range is a cheap proxy for path
   * length — good enough to size a fleet, and it costs no pathfinding.
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
   * The road is Mining's to claim: the container is only worth having if haulers can reach it, and
   * `sourceRoadPath` computes the whole route anyway to find where the container goes. Leaving the
   * road to the bunker stamp meant claiming a container the layout had no reason to connect.
   */
  public override structures(colony: ColonySnapshot, planned: readonly PlacedStructure[] = []): PlacedStructure[] {
    if (colony.controllerLevel < MIN_CONTAINER_RCL) return [];

    const type = sourceStructureType(colony.controllerLevel);
    // The RCL gate that lived in building.ts: an operation that cannot afford a container does not
    // ask for one, exactly as desiredCreeps() is gated by current state.
    if (type === "container" && colony.controllerLevel < CONTAINERS_FROM_RCL) return [];

    const out: PlacedStructure[] = [];
    // Tiles already spoken for — by the layout, by a sibling operation, or by Mining's own earlier
    // sources in this same loop. Claiming a tile something else already claims would have
    // planBuilding place two structures on one square.
    //
    // Built structures are deliberately **not** in this set. A claim is a statement of what should
    // exist, not a request to place a site: planBuilding skips placement for what already stands,
    // and tears down whatever no operation claims. Dropping a claim because the structure was
    // finished would make Mining demolish its own container the tick after it went up.
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
   * Source-spot bookkeeping, so roles avoid re-pathing every tick.
   *
   * Emitted **only when the write would change something**. This channel runs every tick now, and
   * the previous version rewrote identical values unconditionally — harmless when sampled every
   * 50th tick, pure waste at 1/1. An intent that changes nothing is not emitted at all, which is
   * the rule the base class states: the operation decides, because only it knows which of its
   * writes are idempotent.
   *
   * Note this deliberately does not re-path just to check. `sourceRoutes` is the expensive part and
   * it runs regardless; the comparison is against what is already recorded.
   */
  public override intents(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = [];
    // The same baseline building.ts seeds its poll with, so the spot recorded here is the spot that
    // actually gets built. Derived rather than passed: this channel is not arbitrated, so there is
    // no poll to hand it in.
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
   * Private, and the shared derivation every channel reads, so the recorded spot can never disagree
   * with the built spot.
   *
   * Pathed against built **and planned** structures. Built-only was a latent bug: the route ran
   * through ground the layout will occupy, so the container position shifted the tick that structure
   * went up — and a moved position makes planBuilding demolish and re-place the container forever.
   * Planned tiles are the same obstacles, just not yet standing.
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
