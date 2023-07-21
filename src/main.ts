import { EmpireManager } from "empire/EmpireManager";
import { Bunker } from "empire/operations/Operations/roomPlanner/Bunker";
//import { ErrorMapper } from "utils/ErrorMapper";
import { Logger } from "utils/Logger";
import { MemoryUtil } from "empire/memory/MemoryUtils";
//import { defineProtos } from "utils/prototypes/prototypes";
import { Traveler } from "utils/traveler/Traveler";
//import { defineRoomVisualProto } from "utils/prototypes/visual";


//defineRoomVisualProto();
//defineProtos();
console.log("Did run Import of protoypes");
// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code


Creep.prototype.travelTo = function(destination: RoomPosition|{pos: RoomPosition}, options?: TravelToOptions) {
  return Traveler.travelTo(this, destination, options);
};

global.logger = new Logger("WARNING");

function main(): void {

  MemoryUtil.load();

  if(!global.Empire) {
    delete global.Empire;
    global.Empire = new EmpireManager();

  } else {
    global.Empire.init();
    global.Empire.run();
    global.Empire.destroy();
  }

  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }




}


export const loop = () => {


  main();
};
