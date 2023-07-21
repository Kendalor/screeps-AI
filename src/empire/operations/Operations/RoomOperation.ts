import { OperationsManager } from "empire/OperationsManager";
import { Operation, OperationProto } from "../Operation";

export interface RoomOperationProto extends OperationProto {
    data: RoomOperationData;
}

export interface RoomOperationData extends OperationData {
    [id: string]: any;
    roomName: string;
}


export class RoomOperation extends Operation {
    public room: Room;

    constructor(name: string, manager: OperationsManager, entry: RoomOperationProto) {
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

    public static getDataTemplate(roomName: string, nparent: string): OperationData {
        return {room: roomName, parent: nparent};
    }
}