// The actuator: calls the game API and logs any non-OK result. Non-game side effects (e.g. recordSourceSpot's Memory write) live here too, so planners stay pure.

import { log } from "../lib/log";
import { recordManual, wrapFn } from "../lib/profiler";
import { roomType } from "../lib/roomName";
import { remoteRouteTileKey, resolvePathToSource } from "../lib/remotePath";
import { findAnchorCandidates, pickAnchor, walkablePixelsForRoom } from "../layouts/stamp";
import { neighborhoodFullyScouted, summarizePotential } from "../mining/colonizationPotential";
import { MAX_REMOTE_HOPS } from "../mining/pickRemotes";
import { scoutCandidatesAround } from "../snapshot/scoutGraph";
import type { RemoteMemory, RemoteSourceMemory, RouteMemory, ScoutInfo } from "../memory/schema";
import type { Intent } from "./types";

declare const __PROFILER_ENABLED__: boolean;

// The farthest the scouting frontier grows, in rooms. Legacy's MAX_RANGE. Lives here because
// advanceScoutRadius owns the radius write and its bounds.
const MAX_SCOUT_RANGE = 6;

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
    case "assignLogisticsTask": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      // Store the whole task chain under `current`; its follow-up legs stay nested in `current.next`
      // (pickup->pickup->...->deliver). runTransport promotes `current.next` the moment the current leg
      // completes, walking the chain with no idle re-plan tick between legs.
      creep.memory.logistics = { current: intent.task };
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
    case "setScoutTarget": {
      const creep = Game.getObjectById(intent.creep);
      if (!creep) return ERR_NOT_FOUND;
      const target = nearestScoutCandidate(creep.room.name, intent.candidates);
      if (!target) return ERR_NOT_FOUND;
      // Recorded before overwriting scoutTarget so the next pick can avoid sending the scout straight
      // back here â€” without it, two rooms mutually nearest each other ping-pong a scout forever.
      creep.memory.lastRoom = creep.room.name;
      creep.memory.scoutTarget = target;
      creep.memory.route = routeTo(creep.room.name, target);
      return OK;
    }
    case "advanceScoutRadius": {
      const mem = (Memory.scouting ??= { radius: 1 });
      if (mem.radius < MAX_SCOUT_RANGE) mem.radius += 1;
      return OK;
    }
    case "setRemotes": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [] });
      // A re-selection replaces the whole array, but dangerUntil is a live-derived fact about a room, not
      // part of what pickRemotes decides â€” carry it over so a mid-invasion reselection doesn't heal it.
      const priorDangerUntil = new Map(mem.remotes.map(r => [r.room, r.dangerUntil]));
      mem.remotes = intent.remotes
        .map(room => resolveRemoteRoom(intent.room, room, mem.anchor, resolvedRouteTiles))
        .filter(hasSourcesLeft)
        .map(room => ({ ...room, dangerUntil: priorDangerUntil.get(room.room) }));
      return OK;
    }
    case "recordRemoteDanger": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [] });
      const remote = mem.remotes.find(r => r.room === intent.remoteRoom);
      if (remote) remote.dangerUntil = intent.dangerUntil;
      return OK;
    }
    case "addColonizeTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [] });
      // ??= only initializes a brand-new colony record; an existing one from before `colonizing` was
      // added to the schema still lacks the field entirely, so it must be backfilled here too.
      mem.colonizing ??= [];
      if (!mem.colonizing.includes(intent.target)) mem.colonizing.push(intent.target);
      return OK;
    }
    case "removeColonizeTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [] });
      mem.colonizing = (mem.colonizing ?? []).filter(t => t !== intent.target);
      return OK;
    }
    case "addAttackTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [] });
      mem.attacking ??= [];
      if (!mem.attacking.includes(intent.target)) mem.attacking.push(intent.target);
      return OK;
    }
    case "removeAttackTarget": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [] });
      mem.attacking = (mem.attacking ?? []).filter(t => t !== intent.target);
      return OK;
    }
    case "recordSourceSpot": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [] });
      const source = (mem.sources[intent.source] ??= {});
      source.spot = intent.spot;
      // Only ever add an id â€” a tick with no vision must not wipe an existing handle.
      if (intent.container) source.containerId = intent.container;
      if (intent.link) source.linkId = intent.link;
      return OK;
    }
    case "recordRemoteContainer": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [] });
      const source = mem.remotes.find(r => r.room === intent.remoteRoom)?.sources.find(s => s.id === intent.source);
      if (source) source.containerId = intent.container; // only ever adds an id, same rule as recordSourceSpot
      return OK;
    }
    case "recordLinkNetwork": {
      const mem = (Memory.colonies[intent.room] ??= { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [] });
      const links = (mem.links ??= { sources: [] });
      // Only ever adds an id â€” a tick with no fresh detection must not wipe an existing handle.
      if (intent.storage) links.storage = intent.storage;
      if (intent.controller) links.controller = intent.controller;
      return OK;
    }
    default:
      log.error(`no actuator for intent kind "${intent.kind}" yet`);
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
  const anchorChecked = staticKnown ? previous.anchorChecked ?? false : c !== undefined;
  const anchor = staticKnown ? previous.anchor : resolveScoutedAnchor(room, c, sources);
  return {
    tick: Game.time,
    type: roomType(room.name),
    sources,
    ...(mineral ? { mineral } : {}),
    ...(owner ? { owner } : {}),
    ...(anchor ? { anchor } : {}),
    ...(anchorChecked ? { anchorChecked } : {}),
    // "owned by someone other than us" (see ScoutInfo.hostile's doc): a full claim we don't hold (c.my
    // false) OR a reservation under a different username than ours â€” a room WE reserved must read as
    // non-hostile, same as a room we own outright.
    hostile: owner !== undefined && owner !== myUsername() && !c?.my
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

// Nearest of `candidates` from `from`, measured by Game.map.findRoute's real room-graph hop count â€”
// never a Chebyshev/linear-distance estimate, which misprices a diagonal room as adjacent when the map
// only actually connects a room to its N/S/E/W neighbours. Ties (and rooms findRoute can't reach) break
// by name, for determinism across scouts/ticks.
function nearestScoutCandidate(from: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestHops = Infinity;
  for (const room of candidates) {
    const route = Game.map.findRoute(from, room);
    const hops = route === ERR_NO_PATH ? Infinity : route.length;
    if (hops < bestHops || (hops === bestHops && best !== undefined && room.localeCompare(best) < 0)) {
      best = room;
      bestHops = hops;
    }
  }
  return best;
}

// Room-by-room route via Game.map.findRoute; on failure, falls back to just the destination.
function routeTo(from: string, dest: string): RouteMemory {
  const route = Game.map.findRoute(from, dest);
  const rooms = route === ERR_NO_PATH ? [dest] : route.map(step => step.room);
  return { dest, rooms, index: 0 };
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
