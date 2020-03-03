import { Operation } from "empire/operations/Operation";
import { OperationsManager } from "empire/OperationsManager";

export interface OperationProto {
    name: string;
    manager: OperationsManager;
    entry: OperationMemory;
}

export enum OPERATION {
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

export enum ROLE {
    ALLROUNDER=0,
    ATTACKER=1,
    BUILDER=2,
    CLAIMER=3,
    COLONIZE=4,
    HAULER=5,
    LOGISTIC=6,
    MAINTENANCE=7,
    MINER=8,
    REMOVEINVADER=9,
    REPAIRER=10,
    SCOUT=11,
    SUPPLY=12,
    UPGRADER=13
}

export type OperationConstructor = new (name: string, manager: OperationsManager, entry: OperationMemory) => Operation;


export interface OperationMemory {
    data: OperationData;
    type: OPERATION;
    pause: number;
    parent?: string;
}


export interface EmpireMemory {
    toSpawnList: { [name: string]: SpawnEntryMemory };
    operations: { [name: string]: OperationMemory };
    data: {[name: string]: any};
    myRooms: { [name: string]: string };
    hostileRooms?: {[name: string]: any};
    memoryVersion?: number;
  }

export interface OperationData {
    [id: string]: any;
}


