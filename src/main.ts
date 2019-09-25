import { EmpireManager } from "manager/empire/EmpireManager";
import { ErrorMapper } from "utils/ErrorMapper";

import { CreepManager } from "manager/Creeps/CreepManager";
import { defineProtos } from "utils/prototypes/prototypes";
defineProtos();
console.log("Did run Import of protoypes");
// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code
export const loop = ErrorMapper.wrapLoop(() => {
  console.log(`Current game tick is ${Game.time}` + " with Current Bucket " + Game.cpu.bucket);

  const mgr: EmpireManager = new EmpireManager();
  const S_MGR: CreepManager = new CreepManager();
  mgr.run();
  S_MGR.run();



  // Automatically delete memory of missing creeps
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }
  console.log(" CPU Used This Tick: " + Game.cpu.getUsed());
});
