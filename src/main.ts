//import {BunkerPlanner} from "./jobManager/BunkerPlanner";
import {JobManager} from "./jobManager/jobManager";
global.verbose = false;
/**
 * Main loop for screeps, everything in Mainlooop is executed every tick
 */

export const loop = function() {
    delete Memory.JobManager.jobList;
    //const bunker = new BunkerPlanner(Game.rooms["W2N5"]);
    //bunker.run();
    const manager = new JobManager();
    if (!global.roomData) {
      global.roomData = {};
    }
    while (manager.canRun()) {
      manager.runJob();
    }
    manager.kill();
};
