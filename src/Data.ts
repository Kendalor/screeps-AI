import {RoomData} from "./jobManager/RoomData";

export class Data {
  public roomData: RoomData[];
  public currentTick: number;

  public writeToMemory() {
    if (!Memory.roomData) {
      Memory.roomData = {};
    }
    Memory.roomData = this.roomData;
    }
  public readFromMemory() {
    if (!Memory.roomData) { return; }
    this.roomData = Memory.roomData;
  }
}
