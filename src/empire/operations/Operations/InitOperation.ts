import { OperationsManager } from "empire/OperationsManager";
import { OPERATION, OperationMemory } from "utils/constants";
import { Operation } from "../Operation";


/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class InitOperation extends Operation{
    

    constructor(name: string,  manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = OPERATION.INIT;
    }

    public run() {
        if(this.data.scoutingScheduler == null){
           // const name =  this.manager.enque({type: "ScoutingSchedulerOperation",data: {}, priority: 100, pause: 0 });
           // this.data.scoutingScheduler = name;
        }
        this.removeSelf();
    }


}