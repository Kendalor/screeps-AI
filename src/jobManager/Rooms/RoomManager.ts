import {InitialBuildUpJob} from "../InitialBuildUpJob";
import {Job} from "../Job";
import {RoomData} from "./RoomData";

/**
 * RoomManager Class
 * Manages all owned Rooms,is initialized every tick in the Init Job.
 * Forks Jobs To generate Creeps, handle creeps and Build structures.
 */

export class RoomManager extends Job {
  public type = "RoomManager";
  public room: Room;
  public  roomData: RoomData;
  public run() {
    this.room = Game.rooms[this.data.name];
    this.roomData = global.roomData[this.data.name];
    if (!this.room || !this.roomData) {
      this.completed = true;
      console.log("Room: " + !this.room + " roomData " + !this.roomData);
      console.log("Delete: " + this.data.name + " from myRooms");
      delete Memory.myRooms[this.data.name];
      return;
    }

    if (this.room.controller.my) {
      this.manager.addJobIfNotExist("IBU_" + this.room.name, InitialBuildUpJob, 60, {name: this.room.name});
    }
    this.completed = true;
  }
}
