import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "./OperationMemory";
import { RoomOperation } from "./RoomOperation";






/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export default class SupplyOperation extends RoomOperation{
    

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "SupplyOperation";
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */

    public run() {
        super.run();
        const r: Room = this.room;
        if(r != null){
            this.validateCreeps();
    
            if(this.data.creeps.length === 0){
                const name = this.manager.empire.spawnMgr.enque({
                    room: r.name,
                    memory: {role: "Supply", op: this.name},
                    pause: 0,
                    priority: 100,
                    rebuild: false});
                this.data.creeps.push(name);
            }
        }


    }


}