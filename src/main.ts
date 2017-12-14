import {JobManager} from "./jobManager/jobManager";
export const loop = function() {
    const manager = new JobManager();
    while(manager.canRun()) {
      manager.runJob();
    }
    manager.kill();
};
