// Snapshot fixtures for planner tests — plain objects, no game engine.

import { colony, type Colony } from "../src/colony";
import { empire, type Empire } from "../src/empire";
import type { RoleName } from "../src/memory/schema";
import type {
  ColonySnapshot,
  EmpireSnapshot,
  ScoutCandidate,
  SnapContainer,
  SnapLink,
  SnapSink,
  SnapCreep,
  SnapDrop,
  SnapSource,
  SnapRemoteSource,
  SnapRemoteEnergy,
  SnapSpawn,
  SnapStructure,
  SnapTombstone,
  SnapRuin,
  SnapTower,
  SnapUnit,
  VisibleRoom
} from "../src/snapshot/types";
import type { ScoutInfo } from "../src/memory/schema";
import { roomType, roomLinearDistance } from "../src/lib/roomName";

// All-walkable terrain — the default for planner fixtures that don't care
// about walls. Tests exercising pathing around obstacles carve their own.
export function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}

export function sourceAt(x: number, y: number, id = `source_${x}_${y}`, openTiles = 8): SnapSource {
  return { id: id as Id<Source>, x, y, openTiles };
}

export function remoteSourceAt(
  x: number,
  y: number,
  room: string,
  over: Partial<Omit<SnapRemoteSource, "x" | "y" | "room">> = {}
): SnapRemoteSource {
  return {
    id: `remote_src_${room}_${x}_${y}` as Id<Source>,
    x,
    y,
    room,
    distance: 1,
    openTiles: 8,
    reserved: false,
    danger: 0,
    ...over
  };
}

export function remoteEnergyAt(
  room: string,
  amount: number,
  kind: SnapRemoteEnergy["kind"] = "dropped",
  id = `remote_${kind}_${room}_${amount}`
): SnapRemoteEnergy {
  return { id: id as SnapRemoteEnergy["id"], room, amount, kind };
}

export function dropAt(x: number, y: number, amount = 50, id = `drop_${x}_${y}`): SnapDrop {
  return { id: id as Id<Resource>, x, y, amount };
}

export function tombstoneAt(x: number, y: number, storeEnergy = 50, id = `tombstone_${x}_${y}`): SnapTombstone {
  return { id: id as Id<Tombstone>, x, y, storeEnergy };
}

export function ruinAt(x: number, y: number, storeEnergy = 50, id = `ruin_${x}_${y}`): SnapRuin {
  return { id: id as Id<Ruin>, x, y, storeEnergy };
}

export function empireSnap(...colonies: ColonySnapshot[]): EmpireSnapshot {
  return { tick: 0, colonies };
}

// The wrapper a colony-scoped planner actually takes. Named separately from colonySnap so neither name lies about
// what it returns, and so no call site has to nest two factories.
export function testColony(over: Partial<ColonySnapshot> = {}): Colony {
  return colony(colonySnap(over));
}

export function testEmpire(...colonies: ColonySnapshot[]): Empire {
  return empire(empireSnap(...colonies));
}

// Stub room distance for spawn-routing tests: parses W<x>N<y> names and returns Chebyshev distance,
// the same shape Game.map.getRoomLinearDistance has, with no Game involved.
export function roomDistance(a: string, b: string): number {
  const at = (n: string) => {
    const m = /W(\d+)N(\d+)/.exec(n);
    return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
  };
  const pa = at(a);
  const pb = at(b);
  return Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y));
}

export function colonySnap(over: Partial<ColonySnapshot> = {}): ColonySnapshot {
  return {
    name: "W1N1",
    tick: 0,
    towers: [],
    hostiles: [],
    woundedFriendlies: [],
    safeModeAvailable: false,
    safeModeActive: 0,
    safeModeCount: 0,
    creeps: [],
    spawns: [],
    spawnSinks: [],
    energyAvailable: 300,
    energyCapacity: 300,
    sources: [sourceAt(20, 10)],
    remoteSources: [],
    remoteStrikes: {},
    remoteEnergy: [],
    drops: [],
    tombstones: [],
    ruins: [],
    terrain: openTerrain(),
    controller: { x: 25, y: 25 },
    controllerLevel: 1,
    controllerProgress: 0,
    controllerProgressTotal: 0,
    storageEnergy: 0,
    storageCapacity: 0,
    containers: [],
    links: [],
    terminalEnergy: 0,
    terminalCapacity: 0,
    anchor: null,
    sourceMemory: {},
    linkNetwork: {},
    structures: [],
    sites: [],
    remoteStructures: {},
    remoteSites: {},
    remoteDanger: {},
    remoteReservedBy: {},
    siteSummary: [],
    constructionProgress: 0,
    remoteConstructionProgress: 0,
    scoutTargets: [],
    visibleRooms: [],
    colonizing: [],
    attacking: [],
    drainRoute: [],
    hostileRoomTowers: {},
    hostileRoomUnits: {},
    hostileRoomStorageEnergy: {},
    drainRoomTerrain: {},
    drainRoomOccupancy: {},
    ...over
  };
}

// A scout candidate room, distance and type derived from the name so a test only states the name
// and (optionally) what was last observed. `origin` defaults to the standard fixture colony W1N1.
export function scoutTarget(room: string, info?: ScoutInfo, origin = "W1N1"): ScoutCandidate {
  return { room, distance: roomLinearDistance(origin, room), type: roomType(room), info };
}

// A room with ambient vision this tick — Scouting's passive-recording input. Only a name and what
// was last observed; no distance/type, since passive recording doesn't care where the room sits.
// hostileCount defaults to 0 (clear) — pass it explicitly for Attack tests that need a hostile room.
export function visibleRoom(room: string, info?: ScoutInfo, hostileCount = 0, invaderCoreLevel?: number): VisibleRoom {
  return { room, info, hostileCount, ...(invaderCoreLevel !== undefined ? { invaderCoreLevel } : {}) };
}

// A recorded observation, seen `tick` ticks ago (Game.time in tests defaults to 0, so pass an
// absolute tick). Sources/hostility default to a plain surveyed normal room.
export function scouted(over: Partial<ScoutInfo> = {}): ScoutInfo {
  return {
    tick: 0,
    type: "normal",
    sources: [
      { id: "scouted_src_0" as Id<Source>, x: 10, y: 10 },
      { id: "scouted_src_1" as Id<Source>, x: 40, y: 40 }
    ],
    hostile: false,
    ...over
  };
}

export function hostileAt(
  x: number,
  y: number,
  id = `hostile_${x}_${y}`,
  healParts = 0,
  over: Partial<Pick<SnapUnit, "attackParts" | "rangedAttackParts" | "toughReduction">> = {}
): SnapUnit {
  return { id: id as Id<Creep>, x, y, hits: 100, hitsMax: 100, healParts, attackParts: 0, rangedAttackParts: 0, toughReduction: 1, ...over };
}

export function woundedAt(x: number, y: number, id = `wounded_${x}_${y}`): SnapUnit {
  return { id: id as Id<Creep>, x, y, hits: 50, hitsMax: 100, healParts: 0, attackParts: 0, rangedAttackParts: 0, toughReduction: 1 };
}

export function towerAt(x: number, y: number, id = `tower_${x}_${y}`, storeEnergy = 0): SnapTower {
  return { id: id as Id<StructureTower>, x, y, storeEnergy, storeCapacity: 1000 };
}

export function structureAt(
  x: number,
  y: number,
  type: BuildableStructureConstant,
  over: Partial<Pick<SnapStructure, "id" | "hits" | "hitsMax">> = {}
): SnapStructure {
  return { x, y, type, id: `${type}_${x}_${y}` as Id<Structure>, hits: 1000, hitsMax: 1000, ...over };
}

export function containerAt(
  x: number,
  y: number,
  storeEnergy = 0,
  id = `container_${x}_${y}`
): SnapContainer {
  return { id: id as Id<StructureContainer>, x, y, storeEnergy, storeCapacity: 2000 };
}

export function linkAt(
  x: number,
  y: number,
  storeEnergy = 0,
  over: Partial<Pick<SnapLink, "id" | "storeCapacity" | "cooldown">> = {}
): SnapLink {
  return { id: `link_${x}_${y}` as Id<StructureLink>, x, y, storeEnergy, storeCapacity: 800, cooldown: 0, ...over };
}

export function spawn(id = "spawn1", busy = false): SnapSpawn {
  return { id: id as Id<StructureSpawn>, busy };
}

// A single spawn/extension energy sink (default capacity 50 = one extension), for logistics-graph tests
// that need individually-reservable spawn/extension targets rather than the energyAvailable aggregate.
export function sinkAt(x: number, y: number, storeEnergy = 0, storeCapacity = 50, id = `sink_${x}_${y}`): SnapSink {
  return { id: id as Id<StructureSpawn | StructureExtension>, x, y, storeEnergy, storeCapacity };
}

let creepSeq = 0;

// One live creep as a requester's satisfaction check sees it. `over` takes any SnapCreep field plus
// extra memory, so a test says `snapCreep("miner", { memory: { sourceId } })` without restating the rest.
export function snapCreep(
  role: RoleName,
  over: Partial<Omit<SnapCreep, "memory">> & { memory?: Partial<CreepMemory> } = {}
): SnapCreep {
  const { memory, ...rest } = over;
  const name = rest.name ?? `${role}_${creepSeq++}`;
  const home = rest.home ?? "W1N1";
  return {
    id: name as Id<Creep>,
    name,
    body: [WORK, CARRY, MOVE],
    spawning: false,
    ticksToLive: 1000,
    room: home, // defaults to home; a scout out on the frontier overrides it
    x: 25, // defaults onto the fixture controller (25,25) so an upgrader reads as "near controller"; override to place elsewhere
    y: 25,
    hits: 100,
    hitsMax: 100,
    fatigue: 0,
    storeEnergy: 0,
    storeCapacity: 50,
    ...rest,
    role,
    home,
    memory: { role, home, ...memory }
  };
}

// `n` creeps of one role — the common shape of "this quota is already met".
export function snapCreeps(role: RoleName, n: number, over: Parameters<typeof snapCreep>[1] = {}): SnapCreep[] {
  return Array.from({ length: n }, () => snapCreep(role, over));
}
