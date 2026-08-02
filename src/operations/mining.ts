// Mining owns getting energy out of the ground: miners and the per-source container/link they drop
// into. Transport off the source is Logistics' job (see operations/logistics.ts). Pure — reads the
// snapshot only.

import { countPart, orderBody } from "../spawn/body";
import { roleDef } from "../behaviors/roles";
import { REMOTE_UNRESERVED_WORK, SOURCE_SATURATING_WORK } from "../behaviors/roles/miner";
import { pickRemotes } from "../mining/pickRemotes";
import { remoteSourceLoadParts } from "../mining/load";
import { PARTS_PER_SPAWN } from "../colony/metrics";
import type { Intent } from "../intents/types";
import GOAL_JSON from "../layouts/Base_2.json";
import { plannedObstacles } from "../layouts/goal";
import { buildCostMatrix, sourceRoadPath, type RoadPathResult } from "../layouts/roads";
import { isExitTile } from "../lib/remotePath";
import { stampLayout, type PlacedStructure } from "../layouts/stamp";
import type { GoalLayout } from "../layouts/sync";
import type { BodyContext } from "../behaviors/types";
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
  remoteSelectionEvery: 1000,
  // Full re-evaluation is much rarer: it's the only pass that can evict a previously-selected source
  // (e.g. one that's gone stale, or a nearer room scouted since), so it deliberately fires far less often
  // than the append-only 1000-tick selection above — thrashing the active set on every throttle tick
  // would fight the haul/road infrastructure already built around it.
  remoteReevaluateEvery: 5000
} as const;

// building.ts's gate on source containers is mining's knowledge of what it needs when.
export const CONTAINERS_FROM_ENERGY_CAPACITY = config.structuresFromEnergyCapacity;

const GOAL = GOAL_JSON as GoalLayout;
const ROAD: BuildableStructureConstant = "road";

function sourceStructureType(rcl: number): BuildableStructureConstant {
  return rcl >= config.linkRcl ? "link" : "container";
}

// sourceRoutes' real inputs are anchor, terrain (static once a room is seen) and structures/planned
// (walkability) — everything else about a colony is irrelevant to a path search. Recomputing a full
// cost matrix + PathFinder search per source, every tick, forever, was 2%+ of total colony CPU on a
// live server for a route that's the same as last tick's the vast majority of the time (profiled via
// lib/profiler.ts — Mining:intents/sourceRoutes/structures were consistently the largest tick-CPU
// consumers even on a colony with ~0 living creeps). Cached per room, keyed on a cheap fingerprint of
// what could actually move a path; a real change (new road/container built, a demolition, RCL-gated
// link swap) invalidates it the very next tick it's read. `Mining` itself is reconstructed fresh every
// tick (see operations/index.ts's operationsFor), so this cache lives at module scope instead.
const routeCache = new Map<string, { fingerprint: string; routes: Map<SnapSource, RoadPathResult> }>();

// Cheap identity tag for the terrain grid: real rooms rebuild their snapshot from the same underlying
// terrain array every tick (it's static for the life of a room), so a same-instance check is enough to
// confirm "this is still the same room's terrain as last time" without hashing 2500 bytes every tick.
// A different array instance (a genuinely different room/scenario, e.g. between unit tests sharing a
// room name) gets a fresh tag so the fingerprint below can't collide with unrelated terrain.
let nextTerrainTag = 0;
const terrainTags = new WeakMap<Uint8Array, number>();

function terrainTag(terrain: Uint8Array): number {
  let tag = terrainTags.get(terrain);
  if (tag === undefined) {
    tag = nextTerrainTag++;
    terrainTags.set(terrain, tag);
  }
  return tag;
}

function routeFingerprint(colony: ColonySnapshot, planned: readonly PlacedStructure[]): string {
  const anchor = colony.anchor;
  // Position + type is enough to detect any walkability-relevant change; order is stable per tick
  // since both colony.structures and planned are rebuilt fresh from the same snapshot/plan each time.
  const structureKey = colony.structures.map(s => `${s.x},${s.y},${s.type}`).join(";");
  const plannedKey = planned.map(p => `${p.x},${p.y},${p.type}`).join(";");
  const sourceKey = colony.sources.map(s => `${s.id},${s.x},${s.y}`).join(";");
  return `${anchor?.x},${anchor?.y}|${colony.controllerLevel}|${structureKey}|${plannedKey}|${sourceKey}|${terrainTag(colony.terrain)}`;
}

const workOf = (c: SnapCreep): number => countPart(c.body, WORK); // live WORK, spawning included

export class Mining extends Operation {
  public readonly kind = "mining";

  public constructor(
    room: string,
    // Sources already claimed by any OTHER colony's Memory.remotes this tick — passed down from
    // Colony's constructor (see colony/index.ts's allSnapshots), the one place an operation is allowed
    // to receive precomputed cross-colony facts (Operation.intents' doc: methods never reach a sibling
    // directly). Defaults to empty so single-Colony construction (tests, etc.) keeps working unchanged.
    private readonly siblingRemoteSourceIds: ReadonlySet<Id<Source>> = new Set()
  ) {
    super(room);
  }

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
    const miners = this.owned(colony, "miner"); // this operation's only — a sibling must not count these

    // Miners predating stage 2 carry no sourceId (PRD §6). Treat as generic cover: borrowed by at
    // most one source, contributing both WORK (toward target) and head (tile safeguard). A single
    // shared pool spans local and remote sources, drawn local-first.
    const pool = { miners: miners.filter(c => c.memory.sourceId === undefined), next: 0 };

    const local: CreepRequest[] = [];
    for (const source of colony.sources) {
      // Sized against THIS source's own container/site — a multi-source room can't average that state
      // across sources, and it must never leak into a remote source's body (see below).
      const body = orderBody(roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony, false, source.id)) ?? []);
      const bodyWork = Math.max(1, countPart(body, WORK));
      local.push(...this.requestsForSource(colony, source.id, source.openTiles, colony.name, miners, pool, body, bodyWork, config.workPerSource));
    }

    // Local-first gate: hold all remote requests until every local source is fully staffed, so the
    // arbiter never fills a remote miner ahead of a home one. `local.length === 0` means no local
    // deficit remains this tick.
    if (local.length > 0) return local;

    const remote: CreepRequest[] = [];
    for (const source of colony.remoteSources) {
      // A hostile remote, or one reserved by someone else (e.g. an Invader-core reservation), stops new
      // miners; in-flight ones age out. reservedBy is already filtered to exclude our own reservation
      // (see remoteRoomVision) — never re-derive that check here.
      if (source.danger > 0 || source.reservedBy !== undefined) continue;
      // bodyContext(colony) would answer with the HOME room's container/link/site state — meaningless
      // for a source that lives in a different room. Remote sizing keys off remote/reserved instead
      // (see minerBody): hasContainer/hasLink no longer drive body shape at all.
      const remoteCtx: BodyContext = { hasContainer: false, hasLink: false, remote: true, reserved: source.reserved };
      const body = orderBody(roleDef("miner")?.body(colony.energyCapacity, remoteCtx) ?? []);
      const bodyWork = Math.max(1, countPart(body, WORK));
      // An unreserved source only regens enough to justify REMOTE_UNRESERVED_WORK (3), not the full
      // 6-WORK target — asking for 6 worth of miners here would overstaff it 2x, each one idling half
      // its WORK parts every tick.
      const wantedWork = source.reserved ? config.workPerSource : REMOTE_UNRESERVED_WORK;
      remote.push(...this.requestsForSource(colony, source.id, source.openTiles, source.room, miners, pool, body, bodyWork, wantedWork));
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
    bodyWork: number,
    wantedWork: number
  ): CreepRequest[] {
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
        targetRoom,
        // Pinned to this colony even for a remote-room targetRoom: only the ONE colony that selected
        // this remote (pickRemotes, cached in its own ColonyMemory.remotes) ever requests a miner for
        // it — never shared/sponsored by a different colony the way Colonize's cross-colony requests
        // are (which deliberately omit spawnRoom). Without this, a colony with a free spawn could
        // opportunistically fulfil an unrelated colony's remote-miner demand, e.g. starving a freshly
        // colonized room's own settler for the sponsor's spawn budget — see fillTo's doc for the fuller
        // reasoning (this file builds its own requests by hand rather than via fillTo).
        spawnRoom: colony.name
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
    // Mining demolish its own container the tick after it went up. Keyed by room too: a remote route
    // can share (x,y) with a home-room tile without being the same tile.
    const taken = new Set(planned.map(p => `${p.room ?? colony.name},${p.x},${p.y}`));
    const claim = (p: PlacedStructure): void => {
      const key = `${p.room ?? colony.name},${p.x},${p.y}`;
      if (taken.has(key)) return;
      taken.add(key);
      out.push(p);
    };

    for (const [source, route] of this.sourceRoutes(colony, planned)) {
      claim({ x: route.structurePos.x, y: route.structurePos.y, type, sourceId: source.id });
      // Claimed source-outward (reversed from path order, which runs anchor->source) so a builder
      // paves the tiles nearest the source first and works back toward the anchor.
      const roadTiles = route.path.slice(0, -1); // last tile is the container, first is the anchor
      for (let i = roadTiles.length - 1; i >= 0; i--) {
        const tile = roadTiles[i];
        claim({ x: tile.x, y: tile.y, type: ROAD, sourceId: source.id });
      }
    }

    // Remote routes reuse the already-computed cross-room PathFinder path (see resolveRemoteRoom in
    // intents/execute.ts) instead of layouts/roads.ts's local-only cost matrix, which has no notion of
    // leaving the room at all. The container claim needs to know what's already built at that tile
    // (colony.remoteStructures), which only exists while the remote room actually has vision this tick —
    // but the road tiles are claimed regardless of remote vision. A route's home-room leg in particular
    // is always visible and never needs it; gating the WHOLE route (including that leg) on remote vision
    // meant losing vision for one tick (e.g. an invader killing the only creep standing in the remote
    // room) dropped the claim entirely, and building.ts's demolition then read the already-built home-room
    // road as stale and tore it down, only to have it re-claimed (and re-sited) the moment vision returned.
    for (const source of colony.remoteSources) {
      const route = source.route;
      if (!route || route.length === 0) continue;

      const container = route[route.length - 1];
      if (colony.remoteStructures[source.room] !== undefined) {
        claim({ x: container.x, y: container.y, room: container.room, type, sourceId: source.id });
      }
      // Same source-outward ordering as the local route above. Exit tiles are skipped here (not just
      // at cache-computation time in remotePath.ts's toRouteTiles) so a route cached before that
      // exclusion existed still self-heals: Screeps refuses a construction site on an exit tile, and an
      // un-droppable claim there would read as permanently unbuilt, stalling gateSourceGroups forever.
      const roadTiles = route.slice(0, -1).filter(tile => !isExitTile(tile));
      for (let i = roadTiles.length - 1; i >= 0; i--) {
        const tile = roadTiles[i];
        claim({ x: tile.x, y: tile.y, room: tile.room, type: ROAD, sourceId: source.id });
      }
    }
    return out;
  }

  /** Source-spot bookkeeping so roles skip re-pathing. Emitted only when the write would change something. */
  public override intents(colony: ColonySnapshot, colonyRequestParts = 0): Intent[] {
    const out: Intent[] = [];

    const remoteSelection = this.remoteSelection(colony, colonyRequestParts);
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

    // Remote container id: the one fact about a remote route that isn't already cached elsewhere
    // (spot/route come from the selection-time PathFinder path, not live vision). Only ever adds an id,
    // same non-destructive rule as recordSourceSpot above, and only ever checked when the remote room
    // has vision this tick — exactly when colony.remoteStructures actually has something to find.
    for (const source of colony.remoteSources) {
      const route = source.route;
      if (!route || route.length === 0) continue;
      const live = colony.remoteStructures[source.room];
      if (!live) continue;

      const spot = route[route.length - 1];
      const container = live.find(s => s.type === "container" && s.x === spot.x && s.y === spot.y);
      if (!container?.id || source.containerId === container.id) continue;

      out.push({
        kind: "recordRemoteContainer",
        room: colony.name,
        remoteRoom: source.room,
        source: source.id,
        container: container.id as Id<StructureContainer>
      });
    }

    // Remote danger: persist this tick's fresh read (see RemoteMemory.dangerUntil) so it survives losing
    // vision. Only emitted with live vision behind it (colony.remoteDanger is populated exactly then, same
    // rule as remoteStructures/remoteSites), so unlike recordRemoteContainer's append-only id, it's safe to
    // move the cached value down as well as up — an all-clear read is real information too. No memory-side
    // dedup is possible here (the snapshot has no read-back of ColonyMemory.remotes[].dangerUntil), so this
    // writes every vision tick; execute.ts's assignment is a cheap, idempotent overwrite either way.
    const dangerSeen = new Set<string>();
    for (const source of colony.remoteSources) {
      if (dangerSeen.has(source.room)) continue;
      if (!(source.room in colony.remoteDanger)) continue; // no vision this tick
      dangerSeen.add(source.room);

      out.push({
        kind: "recordRemoteDanger",
        room: colony.name,
        remoteRoom: source.room,
        dangerUntil: colony.remoteDanger[source.room],
        reservedBy: colony.remoteReservedBy[source.room]
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
   * Two throttle cadences fire this, at different tick moduli: the frequent one (remoteSelectionEvery)
   * runs in append-only mode — previously-selected sources are always kept, at most one new room's worth
   * is added. The much rarer one (remoteReevaluateEvery) runs a full re-rank that can evict a
   * previously-selected source in favor of a genuinely better one (e.g. real path data that's since
   * arrived, or a closer room only just scouted) — see pickRemotes' `reevaluate` flag. Structures/miners
   * already built for an evicted source aren't cleaned up here; staffing gates downstream stop working a
   * source once it drops out of colony.remoteSources.
   */
  private remoteSelection(colony: ColonySnapshot, colonyRequestParts: number): Intent | undefined {
    const reevaluate = colony.tick % config.remoteReevaluateEvery === 0;
    if (colony.tick % config.remoteSelectionEvery !== 0 && !reevaluate) return undefined;

    const remotes = pickRemotes({
      candidates: colony.scoutTargets,
      home: {
        name: colony.name,
        storage: colony.anchor ?? colony.controller,
        energyCapacity: colony.energyCapacity,
        ...this.spawnLoad(colony, colonyRequestParts)
      },
      currentlySelected: colony.remoteSources.map(s => s.id),
      reevaluate,
      excludedSourceIds: this.siblingRemoteSourceIds
    });
    if (remotes.length === 0) return undefined;
    return { kind: "setRemotes", room: colony.name, remotes };
  }

  /**
   * Same colony-fraction formula as the metrics panel's spawn `load` (colony/metrics.ts) — parts /
   * (spawns * PARTS_PER_SPAWN) — so pickRemotes' 85% ceiling reads against the exact number shown on
   * screen. `colonyRequestParts` is the colony-wide outstanding-request total, computed once by the
   * orchestrator and handed in (see Operation.intents' doc comment) — using only Mining's own requests
   * here would undercount every other operation's demand (haulers/transport in particular are often the
   * single largest contributor once remotes are running), letting this gate think there's headroom long
   * after the real, on-screen load has already passed the ceiling.
   *
   * `localLoadParts` is total load minus the summed remoteSourceLoadParts of every currently-selected
   * remote source (same formula pickRemotes prices a candidate with) — what reevaluate's budget nets
   * out first, so it prices new/kept remote candidates against real remaining headroom instead of the
   * bare ceiling. Never negative: currently-selected sources' real (pooled, Logistics-sized) transport
   * cost can exceed this per-source estimate's sum, in which case every part of that excess is correctly
   * attributed to "local" rather than manufacturing negative local load.
   */
  private spawnLoad(
    colony: ColonySnapshot,
    colonyRequestParts: number
  ): { spawnLoad: number; spawnCapacity: number; localLoadParts: number } {
    const livingParts = colony.creeps.reduce((sum, c) => sum + c.body.length, 0);
    const spawnCapacity = colony.spawns.length * PARTS_PER_SPAWN;
    const totalParts = livingParts + colonyRequestParts;
    const remoteLoadParts = colony.remoteSources.reduce(
      (sum, s) => sum + remoteSourceLoadParts(colony.energyCapacity, s.reserved, s.distance),
      0
    );
    return {
      spawnLoad: spawnCapacity > 0 ? totalParts / spawnCapacity : 0,
      spawnCapacity,
      localLoadParts: Math.max(0, totalParts - remoteLoadParts)
    };
  }

  /**
   * Shared route derivation so the recorded spot can never disagree with the built spot. Cached at
   * module scope per room (see routeCache above) — recomputes only when the fingerprint (anchor, RCL,
   * structures/planned) actually changes, not every tick.
   */
  private sourceRoutes(
    colony: ColonySnapshot,
    planned: readonly PlacedStructure[]
  ): Map<SnapSource, RoadPathResult> {
    const anchor = colony.anchor;
    if (!anchor) return new Map();

    const fingerprint = routeFingerprint(colony, planned);
    const cached = routeCache.get(colony.name);
    if (cached && cached.fingerprint === fingerprint) return cached.routes;

    // Containers/roads/ramparts are walkable, so a planned road is preferred — the reason two
    // operations share one route instead of laying parallel ones.
    const costMatrix = buildCostMatrix({
      terrain: colony.terrain,
      structures: [...colony.structures, ...planned]
    });

    const routes = new Map<SnapSource, RoadPathResult>();
    for (const source of colony.sources) {
      const route = sourceRoadPath(anchor, source, costMatrix);
      if (route.structurePos) routes.set(source, route);
    }
    routeCache.set(colony.name, { fingerprint, routes });
    return routes;
  }
}
