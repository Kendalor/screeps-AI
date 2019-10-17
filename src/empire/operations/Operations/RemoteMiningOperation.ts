import { OperationsManager } from "empire/OperationsManager";
import { FlagOperation } from "./FlagOperation";
import { OperationMemory } from "./OperationMemory";

export class RemoteMiningOperation extends FlagOperation {
    
    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.type = "RemonteMiningOperation";
    }

    public run() {
        super.run();
    }
}