import { OperationsManager } from "empire/OperationsManager";
import { FlagOperation } from "./FlagOperation";
import { OperationMemory } from "./OperationMemory";

export class RemoteMiningOperation extends FlagOperation {
    
    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "RemoteMiningOperation";
    }

    public run() {
        super.run();
    }
}