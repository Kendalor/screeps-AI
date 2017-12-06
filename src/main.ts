import {JobManager} from "./jobManager/jobManager";

export const loop = function() {
    console.log("running!!");
    t=new JobManager();
    t.sayHello();
}
