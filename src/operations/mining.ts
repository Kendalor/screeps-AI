// Mining owns getting energy out of the ground: miners and the per-source container/link they drop
// into. Transport off the source is Logistics' job (see operations/logistics.ts). Pure — reads the
// snapshot only.

import { countPart, orderBody } from "../spawn/body";
import { roleDef } from "../behaviors/roles";
import { SOURCE_SATURATING_WORK } from "../behaviors/roles/miner";
import { pickRemotes } from "../mining/pickRemotes";
import type { Intent } from "../intents/types";
import GOAL_JSON from "../layouts/Base_2.json";
import { plannedObstacles } from "../layouts/goal";
import { buildCostMatrix, sourceRoadPath, type RoadPathResult } from "../layouts/roads";
import { stampLayout, type PlacedStructure } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import type { ColonySnapshot, SnapCreep, SnapSource } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { bodyContext } from "../spawn/bodyContext";
import { Operation } from "./operation";

const config = {
  // A container/road claim waits on energy capacity, not RCL: RCL2 + all five extensions = 550.
  // Capacity, not level, is what proves the extension economy exists to fund the container.
  structuresFromEnergyCapacity: 550,
  linkRcl: 7, // link beats container: miner drops straight in, no hauler round trip
  workPerSource: SOURCE_SATURATING_WORK, // shared with miner.ts's body cap so the two can't drift apart
  // Remote selection is cached; re-rank only occasionally so the active set is stable, not thrashing.
  remoteSelectionEvery: 100,
  // Don't attempt remote mining until the home economy is established — a stable, snapshot-derivable
  // proxy for "the spawn can take on more creeps". TODO(remote): a real spawn-busy-fraction signal.
  remoteFromRcl: 3
} as const;

// building.ts's gate on source containers is mining's knowledge of what it needs when.
export const CONTAINERS_FROM_ENERGY_CAPACITY = config.structuresFromEnergyCapacity;

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

function sourceStructureType(rcl: number): BuildableStructureConstant {
  return rcl >= config.linkRcl ? "link" : "container";
}

// Asks the role table rather than restating its formula, sized against the same context the request body uses.
function minerBodyWork(colony: ColonySnapshot): number {
  const body = roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

const workOf = (c: SnapCreep): number => countPart(c.body, WORK); // live WORK, spawning included

export class Mining extends Operation {
  public readonly kind = "mining";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.minerRequests(colony);
  }

  /**
   * Bring each source up to its WORK target (not a headcount), clamped by open tiles. Per-source
   * rather than colony-total so one double-staffed, one bare source can't average out. Local sources
   * first, then selected remote sources — but remote requests are gated behind local sources being
   * fully staffed, so a remote can never starve the home room of its own miners (invariant #3).
   */
  private minerRequests(colony: ColonySnapshot): CreepRequest[] {
    const bodyWork = minerBodyWork(colony);
    const miners = this.owned(colony, "miner"); // this operation's only — a sibling must not count these
    const body = orderBody(roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);

    // Miners predating stage 2 carry no sourceId (PRD §6). Treat as generic cover: borrowed by at
    // most one source, contributing both WORK (toward target) and head (tile safeguard). A single
    // shared pool spans local and remote sources, drawn local-first.
    const pool = { miners: miners.filter(c => c.memory.sourceId === undefined), next: 0 };

    const local: CreepRequest[] = [];
    for (const source of colony.sources) {
      local.push(...this.requestsForSource(colony, source.id, source.openTiles, colony.name, miners, pool, body, bodyWork));
    }

    // Local-first gate: hold all remote requests until every local source is fully staffed, so the
    // arbiter never fills a remote miner ahead of a home one. `local.length === 0` means no local
    // deficit remains this tick.
    if (local.length > 0) return local;

    const remote: CreepRequest[] = [];
    for (const source of colony.remoteSources) {
      if (source.danger > 0) continue; // a hostile remote stops new miners; in-flight ones age out
      remote.push(...this.requestsForSource(colony, source.id, source.openTiles, source.room, miners, pool, body, bodyWork));
    }
    return remote;
  }

  /** One source's miner deficit as concrete requests, drawing the shared unassigned pool first. */
  private requestsForSource(
    colony: ColonySnapshot,
    sourceId: Id<Source>,
    openTiles: number,
    targetRoom: string,
    miners: readonly SnapCreep[],
    pool: { miners: SnapCreep[]; next: number },
    body: BodyPartConstant[],
    bodyWork: number
  ): CreepRequest[] {
    const wantedWork = config.workPerSource;
    const onSource = miners.filter(c => c.memory.sourceId === sourceId);
    const assignedWork = onSource.reduce((s, c) => s + workOf(c), 0);
    // Draw on the unassigned pool before asking for a new creep — WORK already paid for.
    const workGap = Math.max(0, wantedWork - assignedWork);
    let borrowedWork = 0;
    let borrowedHeads = 0;
    while (pool.next < pool.miners.length && borrowedWork < workGap) {
      borrowedWork += workOf(pool.miners[pool.next]);
      borrowedHeads++;
      pool.next++;
    }

    const deficit = workGap - borrowedWork;
    const freeTiles = Math.max(0, openTiles - onSource.length - borrowedHeads);
    const wantedBodies = Math.min(freeTiles, Math.ceil(deficit / bodyWork));
    const out: CreepRequest[] = [];
    for (let i = 0; i < wantedBodies; i++) {
      out.push({
        body,
        priority: roleDef("miner")!.priority,
        memory: { role: "miner", home: colony.name, op: this.name, sourceId },
        targetRoom
      });
    }
    return out;
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

    const remoteSelection = this.remoteSelection(colony);
    if (remoteSelection) out.push(remoteSelection);

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

  /**
   * Throttled remote selection: re-rank the remote source set occasionally and cache it via setRemotes,
   * so the active remote set is stable rather than re-ranked every tick. Emits only when the selection is
   * non-empty — a colony with no worthwhile scouted neighbour stays silent (its remotes are already [],
   * so writing [] would be pure noise every throttle tick). Gated to its throttle tick.
   *
   * NOTE: this never *clears* a previously-selected remote that has gone unprofitable. The staffing gates
   * downstream (danger>0, netEnergy re-check) already stop working a bad remote, and a stale memory entry
   * is re-evaluated on the next non-empty selection; a dedicated clear path is a future refinement.
   */
  private remoteSelection(colony: ColonySnapshot): Intent | undefined {
    if (colony.tick % config.remoteSelectionEvery !== 0) return undefined;

    const remotes = pickRemotes({
      candidates: colony.scoutTargets,
      home: {
        name: colony.name,
        storage: colony.anchor ?? colony.controller,
        energyCapacity: colony.energyCapacity,
        spawnHeadroom: colony.controllerLevel >= config.remoteFromRcl
      }
    });
    if (remotes.length === 0) return undefined;
    return { kind: "setRemotes", room: colony.name, remotes };
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
