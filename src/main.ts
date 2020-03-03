import { EmpireManager } from "empire/EmpireManager";
import { Bunker } from "empire/operations/Operations/roomPlanner/Bunker";
import { ErrorMapper } from "utils/ErrorMapper";
import { Logger } from "utils/Logger";
import { defineProtos } from "utils/prototypes/prototypes";
import { defineRoomVisualProto } from "utils/prototypes/visual";
import { Traveler } from "utils/traveler/Traveler";


defineRoomVisualProto();
// defineProtos();
console.log("Did run Import of protoypes");
// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code

// TEMP END

global.logger = new Logger("ERROR");
global.empire = new EmpireManager();
Creep.prototype.travelTo = function(destination: RoomPosition|{pos: RoomPosition}, options?: TravelToOptions) {
  return Traveler.travelTo(this, destination, options);
};



export const loop = ErrorMapper.wrapLoop(() => {
  // console.log(`Current game tick is ${Game.time}` + " with Current Bucket " + Game.cpu.bucket);
  let time = Game.cpu.getUsed();
  global.empire.init();
  // console.log(" ----------------- INIT CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
  time = Game.cpu.getUsed();
  try {
    global.empire.run();
  } catch (error) {
    console.log("ERROR on run");
  }
  
  // console.log(" ----------------- RUN CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
  time = Game.cpu.getUsed();
  global.empire.destroy();
  // console.log(" ----------------- DESTROY CPU USED ----------------- " + (Game.cpu.getUsed() - time) + " ----------------- ");
  time = Game.cpu.getUsed();


  // Automatically delete memory of missing creeps
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }
  console.log(Game.shard.name +`: Current game tick is ${Game.time}` +" CPU Used This Tick: " + Game.cpu.getUsed());
});
