import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";


/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class InitOperation extends Operation{
    

    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.type = "InitOperation";
    }

    public run() {
        if(this.data.scoutingScheduler == null){
           const name =  this.manager.enque({type: "ScoutingSchedulerOperation",data: {}, priority: 100, pause: 0, lastRun: false });
           this.data.scoutingScheduler = name;
        }
    }


}