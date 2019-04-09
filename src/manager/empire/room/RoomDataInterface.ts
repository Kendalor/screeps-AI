import { RoomOperationInterface } from "./RoomOperations/RoomOperationInterface";

export interface RoomDataInterface {
    mine: boolean;
    operations: RoomOperationInterface[];
}