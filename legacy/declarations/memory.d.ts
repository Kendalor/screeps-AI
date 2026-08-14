// `global` extension samples

interface Memory {
    [name: string]: any;
    creeps: { [name: string]: CreepMemory };
    flags: { [name: string]: FlagMemory };
    rooms: { [name: string]: RoomMemory };
    spawns: { [name: string]: SpawnMemory };
    operations: {[name: string]: any};
  }

// ROOM Types

type ROOM_TYPE = ROOM_TYPE_KEEPER | ROOM_TYPE_HIGHWAY | ROOM_TYPE_INTERSECTION | ROOM_TYPE_NORMAL;

type ROOM_TYPE_KEEPER = 'KeeperRoom';
type ROOM_TYPE_HIGHWAY = 'HighwayRoom';
type ROOM_TYPE_INTERSECTION = 'Intersection';
type ROOM_TYPE_NORMAL = "NormalRoom";

interface RawMemory {
    _parsed: any;
}

interface ISpawnEntryMemory {
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