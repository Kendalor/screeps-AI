import { OperationsManager } from "empire/OperationsManager";
import { FlagOperation } from "./FlagOperation";
import { OperationMemory } from "./OperationMemory";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class ClaimOperation extends FlagOperation{
    public numCreeps: number = 1;

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "ClaimOperation";
    }


    public run() {
        
        this.validateCreeps();
        if(this.flag != null){
            if(this.data.creeps.length < this.numCreeps){
                const roomName = this.findnearestRoom();
                if(roomName != null){
                    for( let i=this.data.creeps.length; i< this.numCreeps; i++){
                        const name = this.manager.empire.spawnMgr.enque({
                            room: roomName,
                            body: undefined,
                            memory: {role: "Claimer", flag: this.flag.name, op: this.name},
                            pause: 0,
                            priority: 71,
                            rebuild: false});
                        this.data.creeps.push(name);
                    }
                } else {
                    this.removeSelf();
                }
            }
        }




        const r = this.flag.room;

        if( r != null && r.controller != null && r.controller.my) {
            this.flag.remove();
        }
        super.run();
    }


}