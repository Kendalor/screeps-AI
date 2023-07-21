interface RoomVisual {
  structure(x: number, y: number, type: StructureConstant, opts?: undefined | any): void
}

declare var Empire: IEmpireManager;

declare namespace NodeJS {
    interface Global {
      [x: string]: any;
      Empire: IEmpireManager | undefined;
      logger: any;
      memoryVersion: number;
    }
  }

interface IOperationMemory {
    data: OperationData;
    type: OPERATION;
    pause: number;
    parent?: string;
}

interface OperationData {
  [id: string]: any;
}

interface IEmpireManager {
  run(): void;
  init(): void;
  build(): void;
  destroy(): void;

  canColonize(): boolean;
  getMyRooms(): string[];
  getBaseOps(): IInitialRoomOperation[];
  opMgr: IOperationsManager;
  creepMgr: ICreepManager;
  spawnMgr: ISpawnManager;
  memoryVersion: number;
  stats: IEmpireStats;
}

interface IEmpireStats {
  empire: IEmpireManager;
  init(): void;
  run(): void;
  destroy(): void;
  addCreep(cpu: number, role:string): void;
  addOp(cpu: number, op: OPERATION): void;


}
interface IOperationsManager {
  empire: IEmpireManager;
  init(): void;
  run(): void;
  destroy(): void;
  getOperationsOfType<T extends IOperation>(type: OPERATION): T[];
  getBaseOperations():  IInitialRoomOperation[];
  enque(entry: IOperationMemory): string;
  entryExists(name: string): boolean;
  getEntryByName<T extends IOperation>(name: string): T | null;
  dequeue(name: string): void;
  getOpCount(): number;
}

interface IInitialRoomOperation extends IOperation{
  room: Room;
  enqueRemoteOp(t: OPERATION, targetRoom: string, flag?: Flag): string | undefined;

}


interface IOperation {
  init(): void;
  run(): void;
  destroy(): void;
  toMemory(): IOperationMemory;
  type: OPERATION;
  priority: number;
  manager: IOperationsManager;
  pause: number;
  didRun: boolean;
  name: string;
  parent?: string;
  data: any;


}
interface ICreepManager {
  empire: IEmpireManager;
  run(): void;

}

interface ISpawnManager {
  empire: IEmpireManager;
  init(): void;
  purge(): void;
  run(): void;
  destroy(): void;
  containsEntry(name: string): boolean;
  enque(entry: ISpawnEntryMemory): string;
  dequeueByName(name: string): void;
}



interface BuildEntry {
  x: number,
  y: number,
  type: BuildableStructureConstant
}



declare const enum OPERATION {
  BASE=1,
  TRADING=2,
  UPGRADE=3,
  DEFEND=4,
  MINING=5,
  CLAIM=6,
  COLONIZE=7,
  INIT=8,
  SUPPLY=9,
  REPAIR=10,
  BUILD=11,
  FLAGLISTENER=12,
  ROOMLOGISTICS=13,
  ROOMPLANNER=14,
  REMOTEMINING=15,
  SCOUTINGMANAGER=16,
  REMOVEINVADER=17,
  HAUL=18,
  MINE_MINERALS=19,
  MINE_POWER=20,
  MINE_DEPOSIT=21,
  COLONIZE_PORTAL=22
}
