import { OperationsManager } from "empire/OperationsManager";
import { OPERATION, OperationMemory } from "utils/constants";
import { RoomOperation, RoomOperationProto } from "./RoomOperation";






/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export default class SupplyOperation extends RoomOperation{
    

    constructor(name: string, manager: OperationsManager, entry: RoomOperationProto) {
        super(name, manager,entry);
        this.type = OPERATION.SUPPLY;
    }
/**
 * Adds Creeps for this Phase to the spawnManager
 */

    public run() {
        super.run();
        const r: Room = this.room;
        if(r != null){
            this.validateCreeps();
            this.defineMaxSupply();
            if(this.data.creeps.length < this.data.maxSupply ){
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

    public defineMaxSupply(): void {
        if(this.room.controller!.level < 3){
            this.data.maxSupply = 0;
        } else if(this.room.controller!.level <8){
            this.data.maxSupply = 1;
        } else {
            this.data.maxSupply =2;
        }
    }


}