import { OperationsManager } from "empire/OperationsManager";
import { RoomOperation, RoomOperationData, RoomOperationProto } from "./RoomOperation";

export interface RemoteOperationProto extends RoomOperationProto {
    data: RemoteOperationData;
}

export interface RemoteOperationData extends RoomOperationData {
    [id: string]: any;
    remoteRoom: string;
}


export abstract class RemoteOperation extends RoomOperation {
    public remoteRoom: Room | undefined;
    public remoteRoomName: string;

    constructor(name: string, manager: OperationsManager, entry: RemoteOperationProto) {
        super(name, manager,entry);
        this.remoteRoom = Game.rooms[entry.data.remoteRoom];
        this.remoteRoomName = entry.data.remoteRoom;
    }

    public run() {
        super.run()
    }
}