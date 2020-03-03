import { OperationsManager } from "empire/OperationsManager";
import { OPERATION,  OperationData, OperationMemory } from "utils/constants";

export interface OperationProto extends OperationMemory {
    data: OperationData;
}

export interface BaseData {
    [id: string]: any;
}

export class Operation implements OperationMemory{
    public data: OperationData;
    public type: OPERATION;
    public priority: number;
    public manager: OperationsManager;
    public pause: number;
    public didRun: boolean;
    public name: string;
    public parent?: string;

        constructor(name: string, manager: OperationsManager, entry: OperationProto){
            this.manager = manager;
            this.data=entry.data;
            this.type=entry.type;
            this.priority= 0;
            this.pause = entry.pause;
            this.didRun = false;
            this.name = name;
            if(this.data.parent != null){
                this.parent = this.data.parent;
            }
        }
    public toMemory(): OperationMemory {
        return {type: this.type, priority:this.priority, pause: this.pause, data: this.data, parent: this.parent} as OperationMemory;
    }

    public run(): void {
        global.logger.debug("Running Operation: ---" + this.type + "---");
        this.didRun=true;
    }

    public validateCreeps(): void {
        if(this.data.creeps != null){
            if(this.data.creeps.length > 0 ){
                for(const name of this.data.creeps){
                    // console.log("Validate Crepps: "+ name);
                    if( Game.creeps[name] == null){
                        if(!this.manager.empire.spawnMgr.containsEntry(name)) {
                            console.log("Validate Crepps: "+ name + " removed");
                            _.remove(this.data.creeps, (e) => e === name);
                        }
                    }
                }
            }
        } else {
            this.data.creeps = [];
        }
    }
    public removeSelf(): void {
        this.manager.dequeue(this.name);
    }

    public checkParent(): void {
        if(this.parent != null){
            if(!this.manager.entryExists(this.parent)){
                console.log("Removed " + this.name + " with Type: " + this.type + " because missing Parent: " + this.parent);
                this.removeSelf();
            }
        }
    }
}