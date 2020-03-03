import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "utils/constants";
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

    constructor(name: string, manager: OperationsManager, entry: RemoteOperationProto) {
        super(name, manager,entry);
        this.remoteRoom = Game.rooms[entry.data.remoteRoom];
    }

    public run() {
        super.run()
    }
}