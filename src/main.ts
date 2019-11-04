import { EmpireManager } from "empire/EmpireManager";
import { Bunker } from "empire/operations/Operations/roomPlanner/Bunker";
import { ErrorMapper } from "utils/ErrorMapper";
import { Logger } from "utils/Logger";


// defineProtos();
console.log("Did run Import of protoypes");
// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code

global.logger = new Logger("ERROR");
global.empire = new EmpireManager();

export const loop = ErrorMapper.wrapLoop(() => {
  console.log(`Current game tick is ${Game.time}` + " with Current Bucket " + Game.cpu.bucket);

  global.empire.init();
  global.empire.run();
  global.empire.destroy();


  // Automatically delete memory of missing creeps
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }
  console.log(" CPU Used This Tick: " + Game.cpu.getUsed());
});
