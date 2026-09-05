// Mining owns getting energy out of the ground: miners and the per-source container/link they drop
// into. Transport off the source is Logistics' job (see operations/logistics.ts). Pure — reads the
// snapshot only.

import { countPart, orderBody } from "../spawn/body";
import { roleDef } from "../behaviors/roles";
import { REMOTE_MINER_PRIORITY, REMOTE_UNRESERVED_WORK, SOURCE_SATURATING_WORK } from "../behaviors/roles/miner";
import { pickRemotes } from "../mining/pickRemotes";
import type { Intent } from "../intents/types";
import { findPath, type FindPath, type RoadPathResult } from "../construction/planner";
import { log } from "../lib/log";
import { isExitTile } from "../lib/remotePath";
import { range, type XY } from "../lib/geometry";
import type { PlacedStructure } from "../construction/stamp";
import type { BodyContext } from "../behaviors/types";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
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

const ROAD: BuildableStructureConstant = "road";

function sourceStructureType(rcl: number): BuildableStructureConstant {
  return rcl >= config.linkRcl ? "link" : "container";
}

const workOf = (c: SnapCreep): number => countPart(c.body, WORK); // live WORK, spawning included

// A link built range-1 of the source occupies one of the (often only 1-2) open harvest tiles outright —
// on some sources that's the ONLY open tile, permanently locking a miner out of its own source. A
// container never had this problem (a miner stands ON it while harvesting), but a miner does NOT stand
// on a link — it harvests beside it and transfers in. Pulling the link back to range 2 frees that tile:
// the miner stands on the range-1 road tile between link and source instead, range 1 of both. `route`
// is the already-computed range-1 anchor->source path (route.path's last entry is that miner-adjacent
// tile) — walked backward for the first earlier tile that's actually range >=2 from the source, rather
// than blindly taking path[length-2], since a diagonal approach can occasionally keep two consecutive
// steps both at range 1. Falls back to the range-1 spot itself if the path is too short to pull back
// (e.g. source sits right next to the anchor) — better a link that reintroduces the old problem on a rare
// layout than no claim at all.
function linkSpot(route: RoadPathResult, source: XY): XY {
  for (let i = route.path.length - 2; i >= 0; i--) {
    if (range(route.path[i], source) >= 2) return route.path[i];
  }
  return route.structurePos;
}

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
      local.push(
        ...this.requestsForSource(
          colony,
          source.id,
          source.openTiles,
          colony.name,
          miners,
          pool,
          body,
          bodyWork,
          config.workPerSource,
          roleDef("miner")!.priority
        )
      );
    }

    // Local-first gate: hold all remote requests until every local source is fully staffed, so the
    // arbiter never fills a remote miner ahead of a home one. `local.length === 0` means no local
    // deficit remains this tick.
    if (local.length > 0) return local;

    const remote: CreepRequest[] = [];
    for (const source of colony.remoteSources) {
      // A hostile remote, one owned by another player, or one reserved by someone else (e.g. an
      // Invader-core reservation), stops new miners; in-flight ones age out. reservedBy/ownedBy are
      // already filtered to exclude us (see remoteRoomVision) — never re-derive either check here.
      if (source.danger > 0 || source.ownedBy !== undefined || source.reservedBy !== undefined) {
        log.debugRoom(
          colony.name,
          `mining skip remote ${source.room}: ${
            source.danger > 0 ? "danger" : source.ownedBy !== undefined ? `ownedBy=${source.ownedBy}` : `reservedBy=${source.reservedBy}`
          }`
        );
        continue;
      }
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
      remote.push(
        ...this.requestsForSource(
          colony,
          source.id,
          source.openTiles,
          source.room,
          miners,
          pool,
          body,
          bodyWork,
          wantedWork,
          REMOTE_MINER_PRIORITY
        )
      );
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
    wantedWork: number,
    priority: number
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
        priority,
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
  public override structures(colony: ColonySnapshot, findPath: FindPath): PlacedStructure[] {
    if (colony.energyCapacity < config.structuresFromEnergyCapacity) return [];

    const type = sourceStructureType(colony.controllerLevel);
    const anchor = colony.anchor;
    if (!anchor) return [];
    const anchorPos = new RoomPosition(anchor.x, anchor.y, colony.name);

    const out: PlacedStructure[] = [];
    for (const source of colony.sources) {
      const sourcePos = new RoomPosition(source.x, source.y, colony.name);
      const route = findPath(anchorPos, sourcePos, 1); // no opts — sources are never inside the bunker footprint
      if (route.path.length === 0) continue; // no path found; findPath already logged
      // A link sits one tile further back than a container (see linkSpot's doc) so the miner's own
      // range-1 tile — route.structurePos, the path's last entry — stays open for it to stand on
      // instead of being occupied by the structure itself. A container keeps the old range-1 placement:
      // the miner stands ON it, same as always.
      const spot = type === "link" ? linkSpot(route, source) : route.structurePos;
      out.push({ x: spot.x, y: spot.y, type, sourceId: source.id });
      // Claimed source-outward (reversed from path order, which runs anchor->source) so a builder
      // paves the tiles nearest the source first and works back toward the anchor. Exit-tile filtering
      // is now the planner's own consolidate() step, not this loop's concern. route.path is the real
      // PathFinder.search result — every step AFTER the anchor, never including it. Everything up to and
      // including the miner's own range-1 tile is road; a link claim on an earlier tile has already
      // removed that one tile from this slice via the `spot`-based cut below (never double-claimed as
      // both road and structure), while a container claim removes its own last (and only) tile the same
      // way `roadTiles` always excluded it.
      const roadTiles = route.path.filter(p => !(p.x === spot.x && p.y === spot.y));
      for (let i = roadTiles.length - 1; i >= 0; i--) {
        out.push({ x: roadTiles[i].x, y: roadTiles[i].y, type: ROAD, sourceId: source.id });
      }
    }

    // Remote routes reuse the already-computed cross-room PathFinder path (see resolveRemoteRoom in
    // intents/execute.ts) instead of the planner's own single-room findPath, which has no notion of
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
      // Danger/reservedBy no longer withholds the claim itself — only whether new sites get placed
      // and builders dispatched into the remote room (building.ts's unsafeRemoteRooms handles both).
      // Dropping the claim here demolished the whole route (home-room leg included) the instant a
      // single hostile — even an unarmed scout passing through, see isCombatCapable — entered the
      // remote room, only to have it re-claimed and re-sited once danger cleared. The claim now
      // simply tracks source selection, same as the local-source loop above.
      const container = route[route.length - 1];
      if (colony.remoteStructures[source.room] !== undefined) {
        out.push({ x: container.x, y: container.y, room: container.room, type, sourceId: source.id });
      }
      // Same source-outward ordering as the local route above. Exit tiles are skipped here (not just
      // at cache-computation time in remotePath.ts's toRouteTiles) so a route cached before that
      // exclusion existed still self-heals — redundant with the planner's own consolidate() exit-tile
      // drop, but harmless to keep (see this class's header note on this being optional cleanup).
      const roadTiles = route.slice(0, -1).filter(tile => !isExitTile(tile));
      for (let i = roadTiles.length - 1; i >= 0; i--) {
        const tile = roadTiles[i];
        out.push({ x: tile.x, y: tile.y, room: tile.room, type: ROAD, sourceId: source.id });
      }
    }
    return out;
  }

  /** Source-spot bookkeeping so roles skip re-pathing. Emitted only when the write would change something. */
  public override intents(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = [];

    const remoteSelection = this.remoteSelection(colony);
    if (remoteSelection) out.push(remoteSelection);

    const anchor = colony.anchor;
    if (anchor) {
      const anchorPos = new RoomPosition(anchor.x, anchor.y, colony.name);
      for (const source of colony.sources) {
        const sourcePos = new RoomPosition(source.x, source.y, colony.name);
        const route = findPath(colony, anchorPos, sourcePos, 1); // reads matrixCache — see planner.ts's cross-tick guarantee
        if (route.path.length === 0) continue; // no path found; findPath already logged
        const spot = route.structurePos; // the miner's own range-1 tile — unchanged whether a container or a link is fed
        const container = colony.containers.find(c => c.x === spot.x && c.y === spot.y);
        // Detected by proximity to the source (range <=2, matching linkSpot's own pullback ceiling),
        // not by matching the exact tile linkSpot computes today — mirrors upgrading.ts's controller-link
        // detection for the identical reason: a link built before the range-2 pullback existed (or nudged
        // aside by a later road/obstacle change) sits one tile off from where a fresh route lands, and an
        // exact-match search would never see it again, leaving it full forever even though it's real and
        // working. Anchor/controller link ids are excluded so a nearby non-source link (rare, but the
        // controller link legitimately can sit close to a source in a cramped layout) is never misfiled
        // as this source's link — same non-structural, id-based exclusion links.ts's own regression
        // test (the "mystery link" case) already relies on.
        const link = colony.links.find(
          l =>
            l.id !== colony.linkNetwork.storage &&
            l.id !== colony.linkNetwork.controller &&
            range(l, source) <= 2
        );
        const recorded = colony.sourceMemory[source.id];

        const spotUnchanged = recorded?.spot?.x === spot.x && recorded?.spot?.y === spot.y;
        const containerUnchanged = !container || recorded?.containerId === container.id; // execute.ts only ever adds an id
        const linkUnchanged = !link || recorded?.linkId === link.id; // same only-ever-adds rule
        if (spotUnchanged && containerUnchanged && linkUnchanged) continue;

        out.push({
          kind: "recordSourceSpot",
          room: colony.name,
          source: source.id,
          spot: { x: spot.x, y: spot.y },
          ...(container ? { container: container.id } : {}),
          ...(link ? { link: link.id } : {})
        });
      }
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

    // Remote route road built-state: confirms a route tile is actually built (see RemoteSourceMemory.
    // routeBuilt's doc) using whichever live structure list covers that tile's room — the source's own
    // room (colony.remoteStructures, same as the container check above) for the route's last leg, or
    // colony.visibleRoomRoads for a transit room in between (remoteStructures is never populated for a
    // room the route merely passes through). Only emitted for a tile whose room has vision this tick AND
    // isn't already confirmed — append-only, one intent per newly-confirmed index.
    for (const source of colony.remoteSources) {
      const route = source.route;
      if (!route || route.length === 0) continue;
      const alreadyBuilt = source.routeBuilt ?? "";
      for (let i = 0; i < route.length; i++) {
        if (alreadyBuilt[i] === "1") continue;
        const tile = route[i];
        const roomRoads =
          tile.room === source.room ? colony.remoteStructures[tile.room]?.filter(s => s.type === ROAD) : colony.visibleRoomRoads[tile.room];
        if (!roomRoads) continue; // no vision of this tile's room this tick
        if (!roomRoads.some(r => r.x === tile.x && r.y === tile.y)) continue;

        out.push({ kind: "recordRemoteRouteBuilt", room: colony.name, remoteRoom: source.room, source: source.id, index: i });
      }
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
   * Throttled remote selection: re-rank the remote room set occasionally and cache it via setRemotes, so
   * the active remote set is stable rather than re-ranked every tick. Emits only when the selection is
   * non-empty — a colony with no worthwhile scouted neighbour stays silent (its remotes are already [],
   * so writing [] would be pure noise every throttle tick). Gated to its throttle tick.
   *
   * Two throttle cadences fire this, at different tick moduli: the frequent one (remoteSelectionEvery)
   * runs in append-only mode — previously-selected rooms are always kept, at most one new room is added.
   * The much rarer one (remoteReevaluateEvery) runs a full re-rank that can evict a previously-selected
   * room in favor of a genuinely better one (e.g. real path data that's since arrived, or a richer room
   * only just scouted) — see pickRemotes' `reevaluate` flag. Structures/miners already built for an
   * evicted room aren't cleaned up here; staffing gates downstream stop working a source once it drops
   * out of colony.remoteSources.
   *
   * A third, ad-hoc trigger forces reevaluate early: any currently-selected source whose room is now
   * OWNED by another player (colony.remoteSources[].ownedBy — see snapshot/colony.ts's remoteRoomVision).
   * mining/reservation/construction already stop staffing/reserving/building it the same tick ownership is
   * observed (their own ownedBy gates), but pickRemotes itself excludes a hostile candidate only by never
   * re-admitting it (info.hostile at candidate-build time) — without this, the dead entry would otherwise
   * sit in ColonyMemory.remotes, unstaffed but still selected, for up to remoteReevaluateEvery ticks.
   */
  private remoteSelection(colony: ColonySnapshot): Intent | undefined {
    const ownedByOther = colony.remoteSources.some(s => s.ownedBy !== undefined);
    const reevaluate = colony.tick % config.remoteReevaluateEvery === 0 || ownedByOther;
    if (colony.tick % config.remoteSelectionEvery !== 0 && !reevaluate) return undefined;

    const { remotes, strikes } = pickRemotes({
      candidates: colony.scoutTargets,
      home: {
        name: colony.name,
        storage: colony.anchor ?? colony.controller,
        energyCapacity: colony.energyCapacity,
        spawnCount: colony.spawns.length
      },
      currentlySelected: colony.remoteSources.map(s => s.id),
      reevaluate,
      excludedSourceIds: this.siblingRemoteSourceIds,
      strikes: colony.remoteStrikes
    });
    // A genuinely empty result is silent UNLESS something was actually selected before — that case is a
    // real eviction (e.g. every currently-selected room just got claimed out from under this colony) and
    // must be written so ColonyMemory.remotes actually clears, not merely silenced the same as "nothing
    // worthwhile has ever been scouted" would be.
    if (remotes.length === 0 && colony.remoteSources.length === 0) return undefined;
    return { kind: "setRemotes", room: colony.name, remotes, strikes };
  }

}
