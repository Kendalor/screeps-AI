import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";

export class FlagListener extends Operation {

    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.type = "FlagListener";
        this.lastRun = true;
    }
    public run() {
        super.run();
        this.cleanFlagMemory();
        for(const key of Object.keys(Game.flags)) {
            const flag: Flag = Game.flags[key];
            if(flag.memory.op == null) {
                this.spawnOp(flag);
            }
        }
    }

    public spawnOp(flag: Flag){
        // Economic Ops
        if(flag.color === COLOR_GREEN) {
            switch(flag.secondaryColor){
                // Remote Mining
                case COLOR_GREEN:
                        const name = this.manager.enque({type: "RemoteMiningOperation", data: {flag: flag.name}, priority: 30,pause: 1, lastRun: false});
                        flag.memory.op = name;
                        
            }
        }
        
        
    }

    public cleanFlagMemory(){
        for(const key of Object.keys(Memory.flags)){
            if(Game.flags[key] == null){
                delete Memory.flags[key];
            }
        }
    }


}