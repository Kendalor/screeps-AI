


// example declaration file - remove these and add your own custom typings

// memory extension samples
interface Memory {
  [name: string]: any;
  creeps: { [name: string]: CreepMemory };
  flags: { [name: string]: FlagMemory };
  rooms: { [name: string]: RoomMemory };
  spawns: { [name: string]: SpawnMemory };
}
interface RoomVisual {
  structure(x: number, y: number, type: StructureConstant, opts?: undefined | any): void
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


// `global` extension samples
declare namespace NodeJS {
  interface Global {
    empire: import("c:/Users/patrickr.INHOUSE/Documents/screeps/src/empire/EmpireManager").EmpireManager;
    logger: any;
    memoryVersion: number;
  }
}
