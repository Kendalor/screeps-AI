interface OperationProto {
    name: string;
    manager: IOperationsManager;
    entry: IOperationMemory;
}



declare const enum ROLE {
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

type OperationConstructor = new (name: string, manager: IOperationsManager, entry: IOperationMemory) => any;

interface IOperationMemory {
    data: OperationData;
    type: OPERATION;
    pause: number;
    parent?: string;
}


interface IEmpireMemory {
    toSpawnList: { [name: string]: ISpawnEntryMemory };
    operations: { [name: string]: IOperationMemory };
    data: {[name: string]: any};
    myRooms: { [name: string]: string };
    hostileRooms?: {[name: string]: any};
    memoryVersion?: number;
}


