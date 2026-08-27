// The actuator: calls the game API and logs any non-OK result. Non-game side effects (e.g. recordSourceSpot's Memory write) live here too, so planners stay pure.

import { hasFortifiedInvaderCore } from "../behaviors/scoutTargets";
import { log } from "../lib/log";
import { recordManual, wrapFn } from "../lib/profiler";
import { roomType } from "../lib/roomName";
import { NO_PATH_RETRY_AFTER, remoteRouteTileKey, resolvePathToSource } from "../lib/remotePath";
import { findAnchorCandidates, pickAnchor, walkablePixelsForRoom } from "../construction/stamp";
import { neighborhoodFullyScouted, summarizePotential } from "../mining/summarizeNeighborhoodPotential";
import { MAX_REMOTE_HOPS } from "../mining/pickRemotes";
import { INVADER_USERNAME } from "../mining/remoteSources";
import { isDangerous } from "../memory/reputation";
import { crossesSealedBorder, scoutCandidatesAround } from "../snapshot/scoutGraph";
import type { RemoteMemory, RemoteSourceMemory, RouteMemory, ScoutInfo } from "../memory/schema";
import type { Intent } from "./types";

declare const __PROFILER_ENABLED__: boolean;

// The farthest the scouting frontier grows, in rooms. Legacy's MAX_RANGE. Lives here because
// advanceScoutRadius owns the radius write and its bounds.
const MAX_SCOUT_RANGE = 8;

export const execute = wrapFn(function execute(intents: Intent[]): void {
  // Tiles chosen by a recordSourcePath/setRemotes resolution earlier in *this* batch â€” passed to the
  // next such resolution as `preferred` so a second source in the same remote room paths onto the
  // first one's corridor instead of an independent line beside it (see remotePath.ts's PREFERRED_TILE_COST).
  // Scoped to one execute() call: a fresh accumulator per tick per colony, never carried across calls.
  const resolvedRouteTiles = new Set<string>();
  for (const intent of intents) {
    // Per-kind timing, gated the same as the rest of lib/profiler.ts (dead-code-eliminated when off) â€”
    // act() is one large switch, so wrapFn's whole-function wrapping can't break it down by intent kind.
    const start = __PROFILER_ENABLED__ ? Game.cpu.getUsed() : 0;
    const result = act(intent, resolvedRouteTiles);
    if (__PROFILER_ENABLED__) recordManual(`execute:act:${intent.kind}`, Game.cpu.getUsed() - start);
    if (result !== OK) {
      log.warn(`intent failed (${result}): ${JSON.stringify(intent)}`);
    }
  }
}, "execute:execute");

function act(intent: Intent, resolvedRouteTiles: Set<string>): ScreepsReturnCode {
  switch (intent.kind) {
    case "towerAttack": {
      const tower = Game.getObjectById(intent.tower);
      const target = Game.getObjectById(intent.target);
      if (!tower || !target) return ERR_NOT_FOUND;
      return tower.attack(target);
    }
    case "towerHeal": {
      const tower = Game.getObjectById(intent.tower);
      const target = Game.getObjectById(intent.target);
      if (!tower || !target) return ERR_NOT_FOUND;
      return tower.heal(target);
    }
    case "towerRepair": {
      const tower = Game.getObjectById(intent.tower);
      const target = Game.getObjectById(intent.target);
      if (!tower || !target) return ERR_NOT_FOUND;
      return tower.repair(target);
    }
    case "safeMode": {
      const controller = Game.rooms[intent.room]?.controller;
      if (!controller) return ERR_NOT_FOUND;
      return controller.activateSafeMode();
    }
    case "spawn": {
      const spawn = Game.getObjectById(intent.spawn);
      if (!spawn) return ERR_NOT_FOUND;
      const name = `${intent.memory.role}_${intent.memory.home}_${Game.time}`;
      // Dry run first so a failure never leaves a half-spawned state.
      const dry = spawn.spawnCreep(intent.body, name, { memory: intent.memory, dryRun: true });
      if (dry !== OK) return dry;
      // Directions are a *preference*, never a lock: pass every walkable exit, road-adjacent first,
      // so a newborn creep still emerges even when its preferred tile is occupied (e.g. an idling
      // supply creep). A single-direction list would strand the creep at 100% progress.
      const dirs = intent.dir !== undefined ? [intent.dir] : spawnExitDirections(spawn);
      return dirs.length > 0
        ? spawn.spawnCreep(intent.body, name, { memory: intent.memory, dryRun: false, directions: dirs })
        : spawn.spawnCreep(intent.body, name, { memory: intent.memory, dryRun: false });
    }
    case "placeSite": {
      const room = Game.rooms[intent.room];
      if (!room) return ERR_NOT_FOUND;
      return room.createConstructionSite(intent.x, intent.y, intent.type);
    }
    case "linkSend": {
      const from = Game.getObjectById(intent.from);
      const to = Game.getObjectById(intent.to);
      if (!from || !to) return ERR_NOT_FOUND;
      return from.transferEnergy(to);
    }
    case "terminalSend": {
      // gh #59's dispatch glue for empire/logistics.ts's matched colony-to-colony transfers — left
      // committed but UNTESTED, same precedent as stewardTaskRunner.ts's own dispatch glue (see that
      // module's header / test/unit/logistics/stewardRegister.test.ts's header for why: this exact
      // seam â€” mockup-server-backed store-mutation testing â€” was already tried and dropped as too
      // unreliable to seed for structurally similar code).
      const terminal = Game.rooms[intent.from]?.terminal;
      if (!terminal) return ERR_NOT_FOUND;
      return terminal.send(intent.resource, intent.amount, intent.to);
    }
    case "marketDeal": {
      return Game.market.deal(intent.order, intent.amount, intent.room);
    }
    case "marketCreateOrder": {
      return Game.market.createOrder({
        type: intent.type === "buy" ? ORDER_BUY : ORDER_SELL,
        resourceType: intent.resource,
        price: intent.price,
        totalAmount: intent.amount,
        roomName: intent.room
      });
    }
    case "marketReprice": {
      return Game.market.changeOrderPrice(intent.order, intent.price);
    }
    case "marketExtendOrder": {
      return Game.market.extendOrder(intent.order, intent.amount);
    }
    case "marketCancelOrder": {
      return Game.market.cancelOrder(intent.order);
    }
    case "setEmpireReservations": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.empireReservations = intent.reservations;
      return OK;
    }
    case "setCreepRole": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      if (creep.memory.role === intent.role) return OK; // already converted; idempotent
      creep.memory.role = intent.role;
      // Fresh step loop for the new role â€” the old task index/lock belonged to the builder's steps.
      creep.memory.task = undefined;
      // Re-stamp for the new role's owning operation â€” leaving this undefined would make the creep
      // "ownable" by every operation via Operation.owned()'s op-less fallback, double-counting it in
      // every operation's roleTargets that doesn't override the default.
      creep.memory.op = intent.op;
      return OK;
    }
    case "setBuildTargetRoom": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      creep.memory.buildTargetRoom = intent.room;
      return OK;
    }
    case "setRepairTargetRoom": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      creep.memory.repairTargetRoom = intent.room;
      return OK;
    }
    case "setDefendTargetRoom": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      creep.memory.defendTargetRoom = intent.room;
      return OK;
    }
    case "setAttackTargetRoom": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      creep.memory.attackTargetRoom = intent.room;
      return OK;
    }
    case "setDrainRallyPos": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      creep.memory.drainRallyPos = intent.pos;
      return OK;
    }
    case "setParadeRallyPos": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      creep.memory.paradeRallyPos = intent.pos;
      return OK;
    }
    case "setSquadJoined": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      creep.memory.squadJoined = intent.op;
      return OK;
    }
    case "clearSquadJoined": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      delete creep.memory.squadJoined;
      return OK;
    }
    case "removeStructure": {
      // Last line of defense: never destroy a spawn here, regardless of intent.
      if (intent.type === "spawn") {
        log.error(`refusing removeStructure for a spawn: ${JSON.stringify(intent)}`);
        return OK;
      }
      const room = Game.rooms[intent.room];
      const structure = room
        ?.lookForAt(LOOK_STRUCTURES, intent.x, intent.y)
        .find(s => s.structureType === intent.type);
      if (!structure) return ERR_NOT_FOUND;
      return structure.destroy();
    }
    case "roomVisual": {
      const visual = new RoomVisual(intent.room);
      for (const o of intent.ops) {
        if (o.op === "text") {
          visual.text(o.text, o.x, o.y, {
            color: o.color,
            align: o.align,
            font: o.size ? `${o.size} monospace` : "monospace"
          });
        } else {
          visual.rect(o.x, o.y, o.w, o.h, { fill: o.fill, opacity: o.opacity });
        }
      }
      return OK; // RoomVisual calls never fail with a return code
    }
    case "recordScout": {
      const room = Game.rooms[intent.room];
      // Vision must actually be present for the observation to be real â€” the operation only emits this
      // for a room with vision in the snapshot, but a tick-boundary loss (creep died, moved on) is possible.
      if (!room) return ERR_NOT_FOUND;
      // Memory.rooms may not exist yet on a fresh isolate; create the container before indexing it.
      const rooms = (Memory.rooms ??= {});
      const mem = (rooms[intent.room] ??= {} as RoomMemory);
      mem.scouted = observeRoom(room, intent.passive ? mem.scouted : undefined);
      log.debugRoom(intent.room, `recordScout${intent.passive ? " (passive)" : ""}: owner=${mem.scouted.owner ?? "-"} sources=${mem.scouted.sources.length}`);
      return OK;
    }
    case "forceRescout": {
      const scouted = (Memory.rooms ??= {})[intent.room]?.scouted;
      if (!scouted || scouted.tick === undefined) return ERR_NOT_FOUND; // nothing on record to invalidate
      log.debugRoom(intent.room, "forceRescout: marking stale (invader core sighted nearby)");
      scouted.tick = 0; // oldest possible tick: needsScouting reads this as maximally stale next check
      return OK;
    }
    case "recordPotential": {
      const rooms = (Memory.rooms ??= {});
      const scouted = rooms[intent.room]?.scouted;
      if (!scouted) return ERR_NOT_FOUND; // emitted off a snapshot that's since gone stale
      const neighborhood = scoutCandidatesAround(intent.room, MAX_REMOTE_HOPS);
      if (!neighborhoodFullyScouted(neighborhood)) return OK; // not ready yet; potentialPrecompute retries next tick
      scouted.potential = summarizePotential(neighborhood);
      scouted.potentialChecked = true;
      return OK;
    }
    case "recordSourcePath": {
      const scouted = (Memory.rooms ??= {})[intent.room]?.scouted?.sources.find(sc => sc.id === intent.source);
      if (!scouted) return ERR_NOT_FOUND; // scouting emitted this off a snapshot that's since gone stale
      const resolved = resolvePathToSource(intent.home, intent.anchor, intent.room, scouted, resolvedRouteTiles, Game.time);
      if (!resolved) return ERR_NOT_FOUND; // no route at all: nothing to cache, retry next scouting pass
      for (const tile of resolved.route) resolvedRouteTiles.add(remoteRouteTileKey(tile));
      return OK;
    }
    case "setScoutTargets": {
      let anyAssigned = false;
      const assigned = assignScoutTargets(intent.assignments);
      if (assigned.length < intent.assignments.length) {
        const unassignedIds = new Set(intent.assignments.map(a => a.creep));
        for (const a of assigned) unassignedIds.delete(a.creep);
        for (const id of unassignedIds) {
          const creep = Game.getObjectById(id);
          if (creep) log.debugCreep(creep.name, "setScoutTargets: no reachable candidate won the assignment round this tick");
        }
      }
      for (const { creep: id, target } of assigned) {
        const creep = Game.getObjectById(id);
        if (!creep) continue;
        anyAssigned = true;
        log.debugCreep(creep.name, `setScoutTargets: assigned scoutTarget=${target} (from ${creep.room.name}, lastRoom=${creep.memory.lastRoom ?? "-"})`);
        // Recorded before overwriting scoutTarget so the next pick can avoid sending the scout straight
        // back here â€” without it, two rooms mutually nearest each other ping-pong a scout forever.
        creep.memory.lastRoom = creep.room.name;
        creep.memory.scoutTarget = target;
        creep.memory.route = routeTo(creep.memory.home, creep.room.name, target);
      }
      return anyAssigned ? OK : ERR_NOT_FOUND;
    }
    case "advanceScoutRadius": {
      const mem = (Memory.scouting ??= { radius: 1 });
      if (mem.radius < MAX_SCOUT_RANGE) {
        mem.radius += 1;
        log.info(`scouting: radius advanced to ${mem.radius}`);
      }
      return OK;
    }
    case "setRemotes": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      // A re-selection replaces the whole array, but dangerUntil is a live-derived fact about a room, not
      // part of what pickRemotes decides â€” carry it over so a mid-invasion reselection doesn't heal it.
      const priorDangerUntil = new Map(mem.remotes.map(r => [r.room, r.dangerUntil]));
      mem.remotes = intent.remotes
        .map(room => resolveRemoteRoom(intent.room, room, mem.anchor, resolvedRouteTiles))
        .filter(hasSourcesLeft)
        .map(room => ({ ...room, dangerUntil: priorDangerUntil.get(room.room) }));
      // Same replace-whole-map write as remotes above, restricted to sources that actually survived
      // resolution (resolveRemoteRoom can drop one with no path yet) â€” a strike entry for a source no
      // longer selected at all would just grow this map forever, see pickRemotes.ts's own doc on this.
      const survivingIds = new Set(mem.remotes.flatMap(r => r.sources.map(s => s.id)));
      mem.remoteStrikes = Object.fromEntries(
        Object.entries(intent.strikes).filter(([id]) => survivingIds.has(id as Id<Source>))
      );
      return OK;
    }
    case "recordRemoteDanger": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      const remote = mem.remotes.find(r => r.room === intent.remoteRoom);
      if (remote) {
        remote.dangerUntil = intent.dangerUntil;
        remote.reservedBy = intent.reservedBy;
      }
      return OK;
    }
    case "addColonizeTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      // ??= only initializes a brand-new colony record; an existing one from before `colonizing` was
      // added to the schema still lacks the field entirely, so it must be backfilled here too.
      mem.colonizing ??= [];
      if (!mem.colonizing.includes(intent.target)) mem.colonizing.push(intent.target);
      if (intent.flag) (mem.colonizingFlags ??= {})[intent.target] = intent.flag;
      return OK;
    }
    case "removeColonizeTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.colonizing = (mem.colonizing ?? []).filter(t => t !== intent.target);
      if (mem.colonizingFlags) delete mem.colonizingFlags[intent.target];
      return OK;
    }
    case "addAttackTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.attacking ??= [];
      if (!mem.attacking.includes(intent.target)) mem.attacking.push(intent.target);
      if (intent.flag) (mem.attackingFlags ??= {})[intent.target] = intent.flag;
      return OK;
    }
    case "removeAttackTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.attacking = (mem.attacking ?? []).filter(t => t !== intent.target);
      if (mem.attackingFlags) delete mem.attackingFlags[intent.target];
      return OK;
    }
    case "addDefendTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.defending ??= [];
      if (!mem.defending.includes(intent.target)) mem.defending.push(intent.target);
      if (intent.flag) (mem.defendingFlags ??= {})[intent.target] = intent.flag;
      return OK;
    }
    case "removeDefendTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.defending = (mem.defending ?? []).filter(t => t !== intent.target);
      if (mem.defendingFlags) delete mem.defendingFlags[intent.target];
      return OK;
    }
    case "setDrainTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.draining = intent.target;
      return OK;
    }
    case "clearDrainTarget": {
      const mem = Memory.colonies[intent.room];
      if (mem) mem.draining = undefined;
      return OK;
    }
    case "setParadeTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.parading = { flag: intent.flag, formation: intent.formation };
      return OK;
    }
    case "clearParadeTarget": {
      const mem = Memory.colonies[intent.room];
      if (mem) mem.parading = undefined;
      return OK;
    }
    case "setSingleTargetOp": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      const byTarget = (mem.singleTargetOps ??= {});
      (byTarget[intent.opKind] ??= {})[intent.target] = {
        flag: intent.flag,
        lifetime: intent.lifetime,
        wanted: intent.numCreeps,
        spawnedCount: 0,
        boostTier: intent.boostTier
      };
      return OK;
    }
    case "clearSingleTargetOp": {
      const byKind = Memory.colonies[intent.room]?.singleTargetOps;
      const byTarget = byKind?.[intent.opKind];
      if (byTarget) delete byTarget[intent.target];
      return OK;
    }
    case "endSingleTargetOp": {
      // Deliberately narrower than clearSingleTargetOp: the entry is emptied (wanted/spawnedCount reset,
      // so Colony's constructor stops attaching an instance for it — see SingleTargetOpState.wanted's
      // "wanted: 0 reads as absent" convention below) but its `flag` field is left standing, one tick
      // longer than the rest of the entry — empire/singleTargetFlags.ts's reconciliation pass runs on a
      // LATER tick and needs the flag name still on record to find and remove the now-orphaned physical
      // flag (execute.ts intent handlers never touch Game.flags themselves). That pass clears the entry
      // fully via clearSingleTargetOp once it's done.
      const entry = Memory.colonies[intent.room]?.singleTargetOps?.[intent.opKind]?.[intent.target];
      if (entry) {
        entry.wanted = 0;
        entry.spawnedCount = 0;
      }
      return OK;
    }
    case "recordSingleTargetSpawn": {
      const entry = Memory.colonies[intent.room]?.singleTargetOps?.[intent.opKind]?.[intent.target];
      if (entry) entry.spawnedCount += intent.by;
      return OK;
    }
    case "recordDrainSample": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      // Scoped per target room (#40/ADR 0006): a stored history against a different (or no) target is
      // stale and replaced with a fresh one rather than appended to.
      if (!mem.drainHistory || mem.drainHistory.room !== intent.target) {
        mem.drainHistory = { room: intent.target, samples: [] };
      }
      mem.drainHistory.samples.push({ tick: intent.tick, towerEnergy: intent.towerEnergy, storageEnergy: intent.storageEnergy });
      return OK;
    }
    case "setDrainAnchor": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.drainAnchor = intent.anchor;
      return OK;
    }
    case "setBoostLabIds": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.boostLabIds = intent.labIds;
      return OK;
    }
    case "setBoostClaims": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.boostClaims = Object.fromEntries(intent.claims.map(c => [c.labId, { compound: c.compound, amount: c.amount }]));
      return OK;
    }
    case "setParadeAnchor": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      mem.paradeAnchor = intent.anchor;
      return OK;
    }
    case "recordSourceSpot": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      const source = (mem.sources[intent.source] ??= {});
      source.spot = intent.spot;
      // Only ever add an id â€” a tick with no vision must not wipe an existing handle.
      if (intent.container) source.containerId = intent.container;
      if (intent.link) source.linkId = intent.link;
      return OK;
    }
    case "recordRemoteContainer": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      const source = mem.remotes.find(r => r.room === intent.remoteRoom)?.sources.find(s => s.id === intent.source);
      if (source) source.containerId = intent.container; // only ever adds an id, same rule as recordSourceSpot
      return OK;
    }
    case "recordMineralRegen": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      // Moves down as well as up (unlike recordSourceSpot's ids) — only ever emitted with live vision
      // behind it, so a cleared value here is real information (regen finished), not a gap to preserve.
      mem.mineral = { regeneratesAt: intent.regeneratesAt };
      return OK;
    }
    case "recordRemoteRouteBuilt": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      const source = mem.remotes.find(r => r.room === intent.remoteRoom)?.sources.find(s => s.id === intent.source);
      if (!source || !source.route || intent.index < 0 || intent.index >= source.route.length) return OK;
      // Pad with "0" up to index if routeBuilt is shorter/absent (route length is stable once cached, but
      // routeBuilt may not have been written for every earlier index yet) — then flip only this index.
      const chars = (source.routeBuilt ?? "0".repeat(source.route.length)).padEnd(source.route.length, "0").split("");
      chars[intent.index] = "1";
      source.routeBuilt = chars.join("");
      return OK;
    }
    case "generatePixel": {
      return Game.cpu.generatePixel();
    }
    case "recordLinkNetwork": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] });
      const links = (mem.links ??= { sources: [] });
      // Only ever adds an id â€” a tick with no fresh detection must not wipe an existing handle.
      if (intent.storage) links.storage = intent.storage;
      if (intent.controller) links.controller = intent.controller;
      return OK;
    }
    default:
      log.error(`no actuator for intent kind "${(intent as Intent).kind}" yet`);
      return OK; // already logged; don't double-report
  }
}

// Our own username, for telling "reserved by us" apart from "reserved by someone else" in observeRoom.
// Derived from any owned room's controller (cheap: Game.rooms is already resident, no extra API cost) and
// memoized per tick since it can't change mid-tick and observeRoom may run once per visible room.
let cachedMyUsernameTick = -1;
let cachedMyUsername: string | undefined;
function myUsername(): string | undefined {
  if (cachedMyUsernameTick !== Game.time) {
    cachedMyUsernameTick = Game.time;
    cachedMyUsername = Object.values(Game.rooms).find(r => r.controller?.my)?.controller?.owner?.username;
  }
  return cachedMyUsername;
}

// What a room's vision shows, distilled to ScoutInfo. Lives here (not a planner) since it reads a live Room.
// `previous`: a passive observation's prior record, if any â€” its static fields (sources/mineral never
// move) are reused instead of re-running FIND_SOURCES/FIND_MINERALS, so ambient vision refreshing many
// rooms every tick stays cheap. An active (non-passive) observation always re-finds everything, since a
// scout's arrival is comparatively rare and correctness of a first-ever survey matters more than cost.
function observeRoom(room: Room, previous: ScoutInfo | undefined): ScoutInfo {
  const c = room.controller;
  const owner = c?.owner?.username ?? c?.reservation?.username;
  const staticKnown = previous?.sources !== undefined;
  const mineral = staticKnown ? previous.mineral : room.find(FIND_MINERALS)[0]?.mineralType;
  const sources = staticKnown ? previous.sources : room.find(FIND_SOURCES).map(s => ({ id: s.id, x: s.pos.x, y: s.pos.y }));
  // Resolved independently of staticKnown/sources: resetScoutedAnchors() (commands/console.ts) clears
  // anchor/anchorChecked on an already-surveyed room (sources stay on record) so a BUNKER_RADIUS change
  // gets picked up on next observation without re-finding sources/mineral too. Gating this on
  // `previous?.anchorChecked` rather than staticKnown means a cleared anchor recomputes even when
  // everything else about the room is still cached.
  const anchorAlreadyChecked = previous?.anchorChecked ?? false;
  const anchorChecked = anchorAlreadyChecked || c !== undefined;
  const anchor = anchorAlreadyChecked ? previous?.anchor : resolveScoutedAnchor(room, c, sources);
  // A STRUCTURE_INVADER_CORE sits independent of any controller (see ScoutInfo.invaderCore's doc), so
  // it needs its own live find rather than piggybacking on the owner/reservation read above. Re-found
  // every observation, active or passive, unlike the static sources/mineral/anchor fields above â€” a
  // core can appear or finish deploying between two passive refreshes of the same room.
  const invaderCore = room
    .find(FIND_HOSTILE_STRUCTURES)
    .find((s): s is StructureInvaderCore => s.structureType === STRUCTURE_INVADER_CORE);
  // Once deployed, a Stronghold's core carries EFFECT_COLLAPSE_TIMER in its own effects list â€” the real
  // decay countdown to when it collapses (docs.screeps.com/invaders.html). ticksToDeploy (below) and this
  // are mutually exclusive in practice: a core either hasn't deployed yet or has, never both.
  const collapseEffect = invaderCore?.effects?.find(
    (e): e is NaturalEffect => "ticksRemaining" in e && e.effect === EFFECT_COLLAPSE_TIMER
  );
  return {
    tick: Game.time,
    type: roomType(room.name),
    sources,
    ...(mineral ? { mineral } : {}),
    ...(owner ? { owner } : {}),
    ...(anchor ? { anchor } : {}),
    ...(anchorChecked ? { anchorChecked } : {}),
    ...(invaderCore
      ? {
          invaderCore: {
            level: invaderCore.level,
            ...(invaderCore.ticksToDeploy !== undefined ? { ticksToDeploy: invaderCore.ticksToDeploy } : {}),
            ...(collapseEffect ? { collapseTicksRemaining: collapseEffect.ticksRemaining } : {})
          }
        }
      : {}),
    // "owned/reserved by another player" (see ScoutInfo.hostile's doc): a full claim we don't hold
    // (c.my false) OR a reservation under a different username than ours â€” a room WE reserved must read
    // as non-hostile, same as a room we own outright. The Invader NPC's own reservation (left by a
    // STRUCTURE_INVADER_CORE) is deliberately excluded: remote-mining selection treats that as
    // temporary/contestable (see remoteInvaderAttacks.ts), not the same permanent "avoid" signal a real
    // player's claim is.
    hostile: owner !== undefined && owner !== myUsername() && owner !== INVADER_USERNAME && !c?.my
  };
}

// The bunker anchor for a scouted (not-yet-owned) room â€” same fit test as the home colony's own
// resolveAnchor (snapshot/colony.ts), but keyed off a room this colony merely has vision of. Only a
// room with a controller can ever host a bunker; terrain+controller+sources are immutable, so this is
// computed once and cached on ScoutInfo.anchor forever after, same as `sources`/`mineral` above.
// Undefined return means "no controller, never attempted" â€” distinguished from "attempted, no fit"
// via observeRoom's separate anchorChecked flag, since both cases return undefined here.
function resolveScoutedAnchor(
  room: Room,
  controller: StructureController | undefined,
  sources: { x: number; y: number }[]
): { x: number; y: number } | undefined {
  if (!controller) return undefined;
  const candidates = findAnchorCandidates(walkablePixelsForRoom(room.name));
  const anchor = pickAnchor(candidates, { controller: { x: controller.pos.x, y: controller.pos.y }, sources });
  return anchor ?? undefined;
}

// Fills in each source's real haul distance, replacing pickRemotes' cheap ranking estimate with the
// ground truth for whatever actually got selected. Reuses a room-memory-cached path when one exists
// (see ScoutedSource.paths); otherwise computes it once via PathFinder and caches it there for every
// future call. A source PathFinder can't reach at all (no anchor yet, or genuinely no route) is dropped
// â€” better to retry next throttle tick than commit to a haul that can never be walked.
function resolveRemoteRoom(
  home: string,
  room: RemoteMemory,
  anchor: { x: number; y: number } | undefined,
  resolvedRouteTiles: Set<string>
): RemoteMemory {
  const roomMem = (Memory.rooms ??= {})[room.room];
  const sources: RemoteSourceMemory[] = [];
  for (const s of room.sources) {
    const scouted = roomMem?.scouted?.sources.find(sc => sc.id === s.id);
    // No scouted record to cache onto, or no anchor yet to path from: nothing to resolve this tick,
    // retry next throttle tick rather than dropping the source outright.
    if (!scouted || !anchor) continue;
    const resolved = resolvePathToSource(home, anchor, room.room, scouted, resolvedRouteTiles, Game.time);
    if (!resolved) {
      log.warn(`setRemotes: no path ${home} -> ${room.room} source ${s.id}, dropping`);
      continue;
    }
    for (const tile of resolved.route) resolvedRouteTiles.add(remoteRouteTileKey(tile));
    sources.push({ ...s, distance: resolved.distance, route: resolved.route });
  }
  return { ...room, sources };
}

function hasSourcesLeft(room: RemoteMemory): boolean {
  return room.sources.length > 0;
}

// Assigns every idle scout in `assignments` to one of its own candidate rooms, via greedy nearest-pair
// matching over Game.map.findRoute's real room-graph hop count (never a Chebyshev/linear-distance
// estimate â€” see scoutGraph.ts's doc on why that misprices diagonal rooms). Each scout independently
// picking its own nearest candidate (the old behaviour) sends every idle scout to the same room whenever
// their pools overlap, since they all agree on which one is nearest â€” greedy matching fixes that by
// removing both the scout and the room from contention as soon as either is claimed, so a second scout
// whose true nearest room is already taken falls through to its next-best option instead of piling on.
//
// Cost: one findRoute call per (scout, candidate) pair considered, same order of magnitude as before
// (the old code already called findRoute once per candidate per scout) â€” just computed as one batch
// instead of once per scout independently.
function assignScoutTargets(
  assignments: readonly { creep: Id<Creep>; candidates: string[] }[]
): { creep: Id<Creep>; target: string }[] {
  type Pair = { creep: Id<Creep>; room: string; hops: number };
  const pairs: Pair[] = [];
  for (const { creep: id, candidates } of assignments) {
    const creep = Game.getObjectById(id);
    if (!creep) continue;
    const home = creep.memory.home;
    for (const room of candidates) {
      // The destination itself is exempt from the noPathFrom exclusion inside dangerRouteCost: a room
      // confirmed unreachable past its border is still a legal scout candidate (see schema.ts's
      // noPathFrom doc â€” the scout just ends up parked at the exit tile, which already fulfills the
      // scouting order). Only rooms findRoute considers passing THROUGH should ever be priced Infinity.
      const route = Game.map.findRoute(creep.room.name, room, {
        routeCallback: (roomName: string) => (roomName === room ? 1 : dangerRouteCost(home, roomName))
      });
      // findRoute can't see the invisible respawn/novice-zone border wall (see crossesSealedBorder's
      // doc) and will happily price straight through one; reject any such route rather than trusting its
      // "reachable" verdict, same as an outright ERR_NO_PATH.
      const hops =
        route === ERR_NO_PATH || crossesSealedBorder([creep.room.name, ...route.map(step => step.room)])
          ? Infinity
          : route.length;
      if (hops !== Infinity) pairs.push({ creep: id, room, hops });
    }
  }

  // Sort by hops ascending; ties broken by room name for determinism across ticks.
  pairs.sort((a, b) => a.hops - b.hops || a.room.localeCompare(b.room));

  const claimedScouts = new Set<Id<Creep>>();
  const claimedRooms = new Set<string>();
  const out: { creep: Id<Creep>; target: string }[] = [];
  for (const pair of pairs) {
    if (claimedScouts.has(pair.creep) || claimedRooms.has(pair.room)) continue;
    claimedScouts.add(pair.creep);
    claimedRooms.add(pair.room);
    out.push({ creep: pair.creep, target: pair.room });
  }
  return out;
}

// Room-by-room route via Game.map.findRoute; on failure, falls back to just the destination.
// `home`: whose noPathFrom cache to consult in dangerRouteCost â€” the colony the travelling creep belongs
// to, not necessarily `from` (a creep may already be mid-route, standing in a transit room).
function routeTo(home: string, from: string, dest: string): RouteMemory {
  // dest is exempt from the noPathFrom exclusion below â€” see assignScoutTargets' identical exemption for why.
  const route = Game.map.findRoute(from, dest, {
    routeCallback: (roomName: string) => (roomName === dest ? 1 : dangerRouteCost(home, roomName))
  });
  // Same sealed-border check as assignScoutTargets: a route findRoute reports as reachable can still
  // cross an invisible respawn/novice-zone wall it has no way to see. Falling back to [dest] here (same
  // as the ERR_NO_PATH case) still lets the creep attempt a direct walk rather than wedging on a route
  // that's provably impossible.
  const rooms = route === ERR_NO_PATH || crossesSealedBorder([from, ...route.map(step => step.room)]) ? [dest] : route.map(step => step.room);
  return { dest, rooms, index: 0 };
}

// Prices a transit room high in findRoute when its last-scouted owner is reputation-flagged
// hostile/dangerous (see memory/reputation.ts) â€” a scout still walks straight to a hostile-owned room if
// that's genuinely where it's assigned to scout, but detours around one it would otherwise just be
// passing through. Mirrors interpreter.ts's dangerRouteCallback for the same reason (Traveler doesn't
// cover a scout's own precomputed room-by-room route); priced high rather than Infinity so a route still
// resolves when no detour exists.
//
// Also excludes (Infinity, not just DANGEROUS_ROOM_HOPS) a room `home`'s own scout has already confirmed
// unreachable at every border it can find from here (see moveToRoom's noPathFrom write, and schema.ts's
// doc) â€” a real PathFinder-backed "no route exists" result, not a mere danger rating, so there's nothing
// to lose by never offering it as a transit hop for a DIFFERENT destination. Does not affect the room's
// own candidacy as a scout target: assignScoutTargets/routeTo only ever call this for rooms findRoute is
// considering passing THROUGH or resolving a direct route span across, never to gate candidate selection.
//
// Also excludes (Infinity) a room proven lethal (schema.ts's ScoutInfo.lethalAt doc) â€” unlike a merely
// hostile owner, DANGEROUS_ROOM_HOPS' "still worth walking through as a detour cost" reasoning doesn't
// apply: a scout that dies crossing it never reaches whatever lay beyond, so routing through is pure loss,
// not a discouraged-but-viable option. needsScouting already keeps a lethal room from being assigned as
// the destination itself, so this only ever matters for rooms findRoute considers passing THROUGH.
const DANGEROUS_ROOM_HOPS = 50;
function dangerRouteCost(home: string, roomName: string): number {
  const info = Memory.rooms?.[roomName]?.scouted;
  const noPathAt = info?.noPathFrom?.[home];
  if (noPathAt !== undefined && Game.time - noPathAt < NO_PATH_RETRY_AFTER) return Infinity;
  if (info?.lethalAt !== undefined && Game.time - info.lethalAt < NO_PATH_RETRY_AFTER) return Infinity;
  // A Stronghold's fortified core (see schema.ts's ScoutInfo.invaderCore doc) is just as much a pure-loss
  // transit hop as a proven-lethal room — same reasoning as the lethalAt check above, see
  // hasFortifiedInvaderCore's doc for why a level-0 core doesn't trigger this.
  if (hasFortifiedInvaderCore(info, Game.time)) return Infinity;
  return isDangerous(info?.owner) ? DANGEROUS_ROOM_HOPS : 1;
}

// All walkable exits around the spawn, ordered as a preference: road tiles first (so the newborn
// lands on a road and doesn't block the spawn), then other open tiles as fallbacks. Passing every
// viable direction â€” not just one â€” means an occupied preferred tile can't strand a finished creep.
const ALL_DIRECTIONS: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];

function spawnExitDirections(spawn: StructureSpawn): DirectionConstant[] {
  const terrain = spawn.room.getTerrain();
  const walkable: { dir: DirectionConstant; road: boolean }[] = [];
  for (const dir of ALL_DIRECTIONS) {
    const pos = posInDirection(spawn.pos, dir);
    if (!pos) continue; // off the edge of the room
    if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) continue;
    const structures = pos.lookFor(LOOK_STRUCTURES);
    const blocked = structures.some(
      s => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_CONTAINER && s.structureType !== STRUCTURE_RAMPART
    );
    if (blocked) continue;
    walkable.push({ dir, road: structures.some(s => s.structureType === STRUCTURE_ROAD) });
  }
  // Stable sort keeping the clockwise ALL_DIRECTIONS order within each group; road tiles float to the front.
  return walkable.sort((a, b) => Number(b.road) - Number(a.road)).map(w => w.dir);
}

function posInDirection(pos: RoomPosition, dir: DirectionConstant): RoomPosition | undefined {
  const deltas: Record<DirectionConstant, [number, number]> = {
    [TOP]: [0, -1],
    [TOP_RIGHT]: [1, -1],
    [RIGHT]: [1, 0],
    [BOTTOM_RIGHT]: [1, 1],
    [BOTTOM]: [0, 1],
    [BOTTOM_LEFT]: [-1, 1],
    [LEFT]: [-1, 0],
    [TOP_LEFT]: [-1, -1]
  };
  const [dx, dy] = deltas[dir];
  const x = pos.x + dx;
  const y = pos.y + dy;
  if (x < 0 || x > 49 || y < 0 || y > 49) return undefined;
  return new RoomPosition(x, y, pos.roomName);
}
