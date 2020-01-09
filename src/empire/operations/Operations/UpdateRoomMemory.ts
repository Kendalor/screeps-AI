import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";







export class UpdateRoomMemory extends Operation{
    
    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "UpdateRoomMemory";
    }


    public run() {
        super.run();
        this.removeSelf();


        const r: Room = Game.rooms[this.data.roomName];
        if(r != null ){
            if(r.memory.scouting == null ){
                this.removeSelf();
            }
            r.memory.scouting.lastSeen = Game.time;
            this.removeSelf();
            console.log("UpdatedRoomMemory");
        }



    }





}