import { EmpireManager } from "manager/empire/EmpireManager";
import { ErrorMapper } from "utils/ErrorMapper";

import { defineProtos } from "utils/prototypes/prototypes";
defineProtos();
console.log("Did run Import of protoypes");
// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code
export const loop = ErrorMapper.wrapLoop(() => {
  console.log(`Current game tick is ${Game.time}`);

  const mgr: EmpireManager = new EmpireManager();
  
  mgr.run();
  for(const c in Game.creeps) {
   Game.creeps[c].run();

  }


  // Automatically delete memory of missing creeps
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }
});
