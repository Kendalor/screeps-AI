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

// TEMP
declare const OPERATION_BASE = 'InitialRoomOperation';
export const OPERATION_UPGRADE = 'UpgradeOperation';
export const OPERATION_DEFEND = 'DefendOperation';
export const OPERATION_MINING = 'MinerOperation';
export const OPERATION_CLAIM = 'ClaimOperation';
export const OPERATION_COLONIZE = 'ColonizeOperation';
declare const OPERATION_INIT = 'InitOperation';
export const OPERATION_SUPPLY = 'SupplyOperation';
const OPERATION_REPAIR = 'RepairOperation';
const OPERATION_BUILD = 'BuildOperation';
const OPERATION_FLAGLISTENER = 'FlagListener';
const OPERATION_HAUL = 'HaulOperation';
const OPERATION_ROOMLOGISTICS = 'RoomLogisticsOperation';
const OPERATION_ROOMPLANNER = 'RoomPlannerOperation';
const OPERATION_UPDATEROOMMEMORY = 'OperationRoomMemory';
const OPERATION_REMOTEMINING = 'RemoteMiningOperation';
const OPERATION_SCOUTINGSHEDULER = 'ScoutingShedulerOperation';

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
  global.empire.run();
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
  console.log(`Current game tick is ${Game.time}` +" CPU Used This Tick: " + Game.cpu.getUsed());
});
