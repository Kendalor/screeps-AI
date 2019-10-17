import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";

export class FlagOperation extends Operation {
    public flag: Flag;
    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.flag = Game.flags[entry.data.flag];
    }

    public run() {
        super.run();
        if(this.flag == null){
            this.lastRun=true;
        }
        if(this.lastRun === true) {
            if(this.flag != null) {
                this.flag.remove();
            }
        }
    }
}