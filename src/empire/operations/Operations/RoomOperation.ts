import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "utils/constants";
import { Operation } from "../Operation";

export class RoomOperation extends Operation {
    public room: Room;

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.room=Game.rooms[entry.data.roomName];
    }

    public run() {
        super.run()
        if(this.room == null) {
            this.removeSelf();
        }
        if(this.data.parent != null){
            const parent = this.manager.getEntryByName(this.data.parent);
            if(parent == null){
                this.removeSelf();
            }
        }
    }

    public getBuildingList(): BuildEntry[] {
        return [];
    }
}