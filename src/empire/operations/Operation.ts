
export interface OperationProto extends IOperationMemory {
    data: OperationData;
}

export interface BaseData {
    [id: string]: any;
}

export class Operation implements IOperationMemory, IOperation{
    public data: OperationData;
    public type: OPERATION;
    public priority: number;
    public manager: IOperationsManager;
    public pause: number;
    public didRun: boolean;
    public name: string;
    public parent?: string;

        constructor(name: string, manager: IOperationsManager, entry: OperationProto){
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
    public toMemory(): IOperationMemory {
        return {type: this.type, priority:this.priority, pause: this.pause, data: this.data, parent: this.parent} as IOperationMemory;
    }

    public init(): void {
        return;
    }

    public destroy(): void {
        return;
    }

    public run(): void {
        global.logger.debug("Running Operation: ---" + this.type + "---");
        this.didRun=true;
    }

    protected validateCreeps(): void {
        if(!this.data.creeps){
            this.data.creeps = [];
        }
        for(const name of this.data.creeps){
            //console.log("Validate Crepps: "+ name);
            if(!Game.creeps[name]){
                //console.log("Creep: " + Game.creeps[name]);
                if(!this.manager.empire.spawnMgr.containsEntry(name)) {
                    //console.log("Validate Crepps: "+ name + " removed");
                    _.remove(this.data.creeps, (e) => e === name);
                }
            }
        }

        
            
    }
    protected removeSelf(): void {
        this.manager.dequeue(this.name);
    }

    protected checkParent(): void {
        if(this.parent != null){
            if(!this.manager.entryExists(this.parent)){
                console.log("Removed " + this.name + " with Type: " + this.type + " because missing Parent: " + this.parent);
                this.removeSelf();
            }
        }
    }
}