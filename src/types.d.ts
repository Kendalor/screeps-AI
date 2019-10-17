// example declaration file - remove these and add your own custom typings

// memory extension samples
interface Memory {
  [name: string]: any;
  creeps: { [name: string]: CreepMemory };
  flags: { [name: string]: FlagMemory };
  rooms: { [name: string]: RoomMemory };
  spawns: { [name: string]: SpawnMemory };
}

interface CreepMemory {
  [name: string]: any;
}
interface FlagMemory {
  [name: string]: any;
}
interface RoomMemory {
  [name: string]: any;
}
interface SpawnMemory {
  [name: string]: any;
}

// `global` extension samples
declare namespace NodeJS {
  interface Global {
    empire: import("c:/Users/patrickr.INHOUSE/Documents/screeps/src/empire/EmpireManager").EmpireManager;
    logger: any;
  }
}
