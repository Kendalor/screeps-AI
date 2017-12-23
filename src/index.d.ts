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
  wait: undefined | string | number;
  parent: string | undefined;
}

interface RoomData {
  constructionSites: ConstructionSite[];
  containers: StructureContainer[];
  extensions: StructureExtension[];
  extractor: StructureExtractor | undefined;
  mineral: Mineral | undefined;
  labs: StructureLab[];
  roads: StructureRoad[];
  spawns: StructureSpawn[];
  sources: Source[];
  sourceContainers: {[id: string]: StructureContainer | undefined};
  towers: StructureTower[];
  upgradeContainer: StructureContainer | undefined;
  sourceSlots: {[id: string]: number};
}
