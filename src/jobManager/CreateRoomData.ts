///<reference path="../../typings/globals/node/index.d.ts"/>
import {Job} from "./Job";

/**
 * RoomData Seralization to write to Memory and load to generate Object
 */

/**
 * Everything the RoomManager needs to know about the Room
 */

//TODO How To force a rebuild? Currently everytime number of Construction Sites globally changes
export class CreateRoomData extends Job {
  public room: Room;
  public type= "CreateRoomDataJob";
  public run() {
    this.room = Game.rooms[this.data.name];
    if (!this.room) {
      this.completed = true;
      return;
    } else {
      if (!global.roomData[this.room.name]) {
        this.build();
      } else {
        //console.log("Read RoomData From Global");
        this.manager.data.roomData[this.room.name] = global.roomData[this.room.name];
        if (this.manager.data.roomData[this.room.name].numConstructionSites !== Object.keys(Game.constructionSites).length) {
          this.build();
        }
      }
    }
    this.completed = true;
  }
  public build() {
    console.log("Wrote roomdata to Global " + Game.time);
    let roomData = {};
    const structures = this.room.find(FIND_STRUCTURES) as Structure[];
    const myStructures = this.room.find(FIND_MY_STRUCTURES) as Structure[];
    roomData = {
      spawns: _.filter(myStructures, function(entry) {return (entry.structureType === STRUCTURE_SPAWN); }) as StructureSpawn[],
    extensions: _.filter(myStructures, function(entry) {return (entry.structureType === STRUCTURE_EXTENSION); }) as StructureExtension[],
    containers: _.filter(structures, function(entry) {return (entry.structureType === STRUCTURE_CONTAINER); }) as StructureContainer[],
    links: _.filter(myStructures, function(entry) {return (entry.structureType === STRUCTURE_LINK); }) as StructureLink[],
    towers: _.filter(myStructures, function(entry) {return (entry.structureType === STRUCTURE_TOWER); }) as StructureTower[],
    walls: _.filter(structures, function(entry) {return (entry.structureType === STRUCTURE_WALL); }) as StructureWall[],
    ramparts: _.filter(myStructures, function(entry) {return (entry.structureType === STRUCTURE_RAMPART); }) as StructureRampart[],
    sources: this.room.find(FIND_SOURCES) as Source[],
    mineral: this.room.find(FIND_MINERALS) as Mineral[],
    sourceContainers: undefined,
    controllerLink: undefined,
    extractor: undefined,
    sourceSlots: this.calculateSourceSlots(),
    constructionSites: this.room.find(FIND_CONSTRUCTION_SITES) as ConstructionSite[],
    roads: _.filter(structures, function(entry) {return (entry.structureType === STRUCTURE_ROAD); }) as StructureRoad[],
    numConstructionSites: Object.keys(Game.constructionSites).length,
    lastUpdated: Game.time
    };
    global.roomData[this.room.name] = roomData as RoomData;
    this.manager.data.roomData[this.room.name] = roomData as RoomData;
  }

  public calculateSourceSlots() {
    const sources = this.room.find(FIND_SOURCES) as Source[];
    const sourceSlots = {} as { [key: string]: number };
    for (const i in sources) {
      let count = 0;
      for (let x = -1; x < 2; x++) {
        for (let y = -1; y < 2; y++) {
          const terrain = this.room.lookForAt(LOOK_TERRAIN, sources[i].pos.x + x, sources[i].pos.y + y)[0];
          if (terrain !== "wall" && !(x === 0 && y === 0)) {
            count = count + 1;
          }
        }//Check for walls around source
      }
      sourceSlots[sources[i].id] = count;
    }
    return sourceSlots;
  }
}
