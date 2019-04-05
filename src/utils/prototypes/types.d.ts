// Interfaces for Defined Variables and Methods of the Prototypes.js File

interface Room {

    coords(): {xId: string, x: number, yId: string, y: number};
    setLastSeen(objectName: string): void;
    lastSeen(objectName: string): number;
    findAll(): number[];
    findConstructionSites(): ConstructionSite[];
    constructionSites: ConstructionSite[];
    clearConstructionSites(): number;
    constructionSitesByType(type: string): ConstructionSite[];
    creeps: Creep[];
    hostileCreeps: Creep[];
    alliedCreeps: Creep[];
    myCreeps: Creep[];
    findMinerals(): Mineral[];
    minerals: Mineral[];
    findResources(): Resource[];
    resources: Resource[];
    findSources(): Source[];
    sources: Source[];
    findStructures(): Structure[];
    structures: Structure[];
    extensions: StructureExtension[];
    extractor: StructureExtractor[];
    keeperLairs: StructureKeeperLair[];
    labs: StructureLab[];
    links: StructureLink[];
    nuker: StructureNuker;
    observer: StructureObserver[];
    powerBank: StructurePowerBank;
    powerSpawn: StructurePowerSpawn;
    ramparts: StructureRampart[];
    spawns: StructureSpawn[];
    towers: StructureTower[];
    containers: StructureContainer[];
    portals: StructurePortal[];
    roads: StructureRoad[];
    constructedWalls: StructureWall[];
}

interface ConstructionSite {
    memory: {[type: string]: {[id: string]: {}}};
}

interface Creep {
    mine(target: Resource): CreepMoveReturnCode | CreepActionReturnCode;
    extract(target: Resource): CreepMoveReturnCode | CreepActionReturnCode;
    inRangeTo(target: RoomObject,range: number): boolean;
    travelTo(target: RoomObject): CreepMoveReturnCode;
    journeyTo(target: RoomObject): CreepMoveReturnCode;
    isBlocked(): boolean;
    leaveBorder(gap: number): CreepMoveReturnCode;
    makeScreepsPinkAgain(): boolean;
    clearSign(): boolean;
    chargeController(controller: StructureController): CreepActionReturnCode;
    park(): true;
    unpark(): true;
    getRandomName(): string;
    run(): void;
   
}

interface Mineral {
    memory: {[id: string]: {}};
}

interface Resource {
    memory: {[id: string]: {}};
}
interface SourceMemory {
    containerPos: { x: number, y: number, roomName: string};
    requiredCarryParts: number;
    slots: number;
    slotsUsed: number;
}
interface Source {
    memory: any;
    slots: number;
    hasFreeSlots(): boolean;
    occupy(creepName: string): boolean;
    deOccupy(creepName: string): boolean;
}

interface Structure {
    memory: {[type: string]: {[id: string]: {}}};
}
