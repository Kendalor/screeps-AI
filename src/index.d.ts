/// <reference path="../typings/globals/lodash/index.d.ts" />
/// <reference path="../typings/globals/node/index.d.ts" />
/// <reference path="../typings/globals/screeps/index.d.ts" />
/// <reference path="../typings/modules/tapable/index.d.ts" />
/// <reference path="../typings/modules/webpack-chain/index.d.ts" />
/// <reference path="../typings/modules/webpack/index.d.ts" />



interface CreepData {
  name: string;
}
interface HarvestData extends CreepData {
  source: string;
}
interface HaulData extends CreepData {
  target: string;
}
interface SerializedJob {
  name: string;
  type: string;
  priority: number;
  data: any;
  wait: boolean;
  parent: string | undefined;
}

interface RoomData {
  lastUpdated: number;
  numConstructionSites: number;
  spawns: StructureSpawn[];
  extensions: StructureExtension[];
  containers: StructureContainer[];
  links: StructureLink[];
  towers: StructureTower[];
  walls: StructureWall[];
  ramparts: StructureRampart[];
  sources: Source[];
  mineral: Mineral;
  sourceContainers: {[key: string]: StructureContainer | StructureLink};
  controllerLink: StructureLink;
  extractor: StructureExtractor;
  constructionSites: ConstructionSite[];
  roads: StructureRoad[];
  sourceSlots: {[key: string]: number};
}

interface RoomManagerData {
  status: string;
}

declare namespace NodeJS {
  interface Global {
    SCRIPT_VERSION: number;
    lastTick: number;
    LastMemory: Memory;
    Memory: Memory;
    roomData: {
      [key: string]: RoomData
    };
  }
}
