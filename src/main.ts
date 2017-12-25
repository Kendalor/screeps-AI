import {JobManager} from "./jobManager/jobManager";

/**
 * Main loop for screeps, everything in Mainlooop is executed every tick
 */

export const loop = function() {
    const manager = new JobManager();
    if(!global.roomData){
      global.roomData = {};
    }
    while (manager.canRun()) {
      manager.runJob();
    }
    manager.kill();
};
