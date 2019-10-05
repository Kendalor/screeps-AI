import { RoomManager } from "../RoomManager";

import { RoomOperation } from "./RoomOperation";
import { RoomOperationInterface } from "./RoomOperationInterface";





/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class SupplyOperation extends RoomOperation{
    

    constructor(manager: RoomManager, entry: RoomOperationInterface) {
        super(manager,entry);
        this.type = "SupplyOperation";
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */

    public run() {
        if(this.firstRun){
            this.onfirstRun();
        }
        this.didRun=true;

        if(this.manager.data.toSpawnList.filter( entry => entry.memory.role === "Supply").length === 0){
            if(Game.rooms[this.roomName].find(FIND_MY_CREEPS).filter( creep => creep.memory.role === "Supply").length === 0){
                this.manager.spawnmgr.enque({
                    memory: {role: "Supply"},
                    name: this.manager.roomName +"_"+this.type ,
                    pause: 0,
                    priority: 100,
                    rebuild: true});
            }
        }

    }


}