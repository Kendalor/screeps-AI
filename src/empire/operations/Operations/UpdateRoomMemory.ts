import { OperationsManager } from "empire/OperationsManager";
import { MapRoom } from "utils/MapRoom";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";







export class UpdateRoomMemory extends Operation{
    
    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.type = "UpdateRoomMemory";
    }


    public run() {
        super.run();
        this.lastRun =true;
        // Init List of Owned Rooms
        if(Memory.rooms[this.data.roomName])
        if(Memory.rooms[this.data.roomName].scouting == null){
            delete Memory.rooms[this.data.roomName];
            this.lastRun=true;
        }
        const r: Room = Game.rooms[this.data.roomName];
        if(r != null ){
            if(r.memory.scouting == null ){
                this.lastRun=true;
            }
            r.memory.scouting.lastSeen = Game.time;
            this.lastRun=true;
            console.log("UpdatedRoomMemory");
        }



    }





}