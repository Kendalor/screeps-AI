import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";

export class RoomOperation extends Operation {
    public room: Room;

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.room=Game.rooms[entry.data.roomName];
    }

    public run() {
        super.run()
        if(this.room == null) {
            this.lastRun = true;
        }
    }
}