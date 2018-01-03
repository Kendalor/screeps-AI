///<reference path="../../typings/globals/node/index.d.ts"/>
import {Job} from "./Job";
import {RoomData} from "./RoomData";

/**
 * RoomData Seralization to write to Memory and load to generate Object
 */

/**
 * Everything the RoomManager needs to know about the Room
 */

export class CreateRoomData extends Job {
  public room: Room;
  public type= "CreateRoomDataJob";
  public run() {
    this.room = Game.rooms[this.data.name];
    if (!this.room) {
      this.completed = true;
      return;
    } else {
      if (!global.roomData[this.room.name]) {
        global.roomData[this.room.name] = new RoomData(this.room.name);
      }
    }
    this.completed = true;
  }
}
