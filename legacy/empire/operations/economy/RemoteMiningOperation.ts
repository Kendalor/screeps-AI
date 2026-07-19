import { OperationsManager } from "empire/OperationsManager";
import { FlagOperation, FlagOperationProto } from "../Operations/FlagOperation";


export class RemoteMiningOperation extends FlagOperation {
    
    constructor(name: string, manager: OperationsManager, entry: FlagOperationProto) {
        super(name, manager,entry);
        this.type = OPERATION.REMOTEMINING;
    }

    public run() {
        super.run();
    }
}