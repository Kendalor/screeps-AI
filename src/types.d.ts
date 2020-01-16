

// example declaration file - remove these and add your own custom typings

// memory extension samples
interface Memory {
  [name: string]: any;
  empire: EmpireMemory;
  creeps: { [name: string]: CreepMemory };
  flags: { [name: string]: FlagMemory };
  rooms: { [name: string]: RoomMemory };
  spawns: { [name: string]: SpawnMemory };
}
interface RoomVisual {
  structure(x: number, y: number, type: StructureConstant, opts?: undefined | any): void
}

interface EmpireMemory {
  toSpawnList: { [name: string]: SpawnEntryMemory };
  operations: { [name: string]: OperationMemory };
  data: {[name: string]: any};
  myRooms: { [name: string]: string };
}

interface SpawnEntryMemory {
  memory: any;
  rebuild: boolean;
  room: string;
  pause: number;
  body?: BodyPartConstant[];
  priority: number;
  toPos?: {x: number, y:number};
}

interface CreepMemory {
  [name: string]: any;
}
interface FlagMemory {
  [name: string]: any;
}
interface RoomMemory {
  [name: string]: any;
  roomType: ROOM_TYPE;
  base? : {bunker: boolean, anchor?: {x: number, y: number}};
  resources?: {sources: string[], mineral: {type: MineralConstant , id: string}};
  owner?: string;
  // temp?: {distanceTransform: number[]};
}

interface SpawnMemory {
  [name: string]: any;
}

interface OperationMemory {
  data: any;
  type: OPERATION;
  priority: number;
  pause: number;
  parent?: string;
}

interface BuildEntry {
  x: number,
  y: number,
  type: BuildableStructureConstant
}
// ROOM Types

type ROOM_TYPE = ROOM_TYPE_KEEPER | ROOM_TYPE_HIGHWAY | ROOM_TYPE_INTERSECTION | ROOM_TYPE_NORMAL;

type ROOM_TYPE_KEEPER = 'KeeperRoom';
type ROOM_TYPE_HIGHWAY = 'HighwayRoom';
type ROOM_TYPE_INTERSECTION = 'Intersection';
type ROOM_TYPE_NORMAL = "NormalRoom";

// Operation Types

type OPERATION = OPERATION_BASE | 
OPERATION_UPGRADE | 
OPERATION_DEFEND | 
OPERATION_MINING | 
OPERATION_CLAIM | 
OPERATION_COLONIZE |
OPERATION_INIT |
OPERATION_SUPPLY | 
OPERATION_REPAIR | 
OPERATION_BUILD | 
OPERATION_FLAGLISTENER | 
OPERATION_HAUL |
OPERATION_ROOMLOGISTICS |
OPERATION_REMOTEMINING |
OPERATION_UPDATEROOMMEMORY |
OPERATION_SCOUTINGMANAGER |
OPERATION_REMOVEINVADER |
OPERATION_ROOMPLANNER;

// Operation types

type OPERATION_BASE = 'InitialRoomOperation';
type OPERATION_UPGRADE = 'UpgradeOperation';
type OPERATION_DEFEND = 'DefenseOperation';
type OPERATION_MINING = 'MinerOperation';
type OPERATION_CLAIM = 'ClaimOperation';
type OPERATION_COLONIZE = 'ColonizeOperation';
type OPERATION_INIT = 'InitOperation';
type OPERATION_SUPPLY = 'SupplyOperation';
type OPERATION_REPAIR = 'RepairOperation';
type OPERATION_BUILD = 'BuildOperation';
type OPERATION_FLAGLISTENER = 'FlagListener';
type OPERATION_HAUL = 'HaulerOperation';
type OPERATION_ROOMLOGISTICS = 'RoomLogisticsOperation';
type OPERATION_ROOMPLANNER = 'RoomPlannerOperation';
type OPERATION_UPDATEROOMMEMORY = 'UpdateRoomMemory';
type OPERATION_REMOTEMINING = 'RemoteMiningOperation';
type OPERATION_SCOUTINGMANAGER = 'OperationScoutingManager';
type OPERATION_REMOVEINVADER = 'RemoveInvaderOperation';

// Operation Constants

declare const OPERATION_BASE: OPERATION_BASE;
declare const OPERATION_UPGRADE: OPERATION_UPGRADE;
declare const OPERATION_DEFEND: OPERATION_DEFEND;
declare const OPERATION_MINING: OPERATION_MINING;
declare const OPERATION_CLAIM: OPERATION_CLAIM;
declare const OPERATION_COLONIZE: OPERATION_COLONIZE;
declare const OPERATION_INIT: OPERATION_INIT;
declare const OPERATION_SUPPLY: OPERATION_SUPPLY;
declare const OPERATION_REPAIR: OPERATION_REPAIR;
declare const OPERATION_BUILD: OPERATION_BUILD;
declare const OPERATION_FLAGLITSENER: OPERATION_FLAGLISTENER;
declare const OPERATION_HAUL: OPERATION_HAUL;
declare const OPERATION_UPDATEROOMMEMORY: OPERATION_UPDATEROOMMEMORY;
declare const OPERATION_ROOMLOGISTICS: OPERATION_ROOMLOGISTICS;
declare const OPERATION_ROOMPLANNER: OPERATION_ROOMPLANNER;
declare const OPERATION_REMOTEMINING: OPERATION_REMOTEMINING;
declare const OPERATION_SCOUTINGMANAGER: OPERATION_SCOUTINGMANAGER;
declare const OPERATION_REMOVEINVADER: OPERATION_REMOVEINVADER;


// `global` extension samples
declare namespace NodeJS {
  interface Global {
    empire: import("c:/Users/patrickr.INHOUSE/Documents/screeps/src/empire/EmpireManager").EmpireManager;
    logger: any;
  }
}
