import { OperationsManager } from "empire/OperationsManager";
import { OPERATION, OperationMemory } from "utils/constants";
import { Operation } from "../Operation";










export class TradingOperation extends Operation{


    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = OPERATION.TRADING;
        if(this.data.todo == null){
            this.data.todo = [];
        }
    }


    public run() {
        super.run();
        console.log("TradingOperation")
    }






}