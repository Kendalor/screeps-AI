import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "./Operations/OperationMemory";

export class Operation implements OperationMemory{
    public data: any;
    public type: string = "none";
    public priority: number;
    public manager: OperationsManager;
    public pause: number;
    public didRun: boolean;
    public lastRun: boolean;

        constructor(manager: OperationsManager, entry: OperationMemory){
            this.manager = manager;
            this.data=entry.data;
            this.type=entry.type;
            this.priority= entry.priority;
            this.pause = entry.pause;
            this.didRun = false;
            this.lastRun = entry.lastRun;
        }
    public toMemory(): OperationMemory {
        return {type: this.type, priority:this.priority, pause: this.pause, data: this.data, lastRun: this.lastRun} as OperationMemory;
    }

    public run(): void {
        global.logger.debug("Running Operation: ---" + this.type + "---");
        this.didRun=true;
    }

    public validateCreeps(): void {
        global.logger.debug("Validate Crepps: ");
        if(this.data.creeps != null){
            if(this.data.creeps.length > 0 ){
                for(const name of this.data.creeps){
                    global.logger.debug("Validate Crepps: "+ name);
                    if( Game.creeps[name] == null){
                        if(!this.manager.empire.spawnMgr.containsEntry(name)) {
                            global.logger.debug("Validate Crepps: "+ name + " removed");
                            _.remove(this.data.creeps, (e) => e === name);
                        }
                    }
                }
            }
        } else {
            this.data.creeps = [];
        }
    }
}