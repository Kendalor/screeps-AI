import {Job} from "./Job";
import {JobManager} from "./jobManager";
import {RoomData} from "./RoomData";

export class RoomJob extends Job {
  public room: Room;
  public roomData: RoomData;
  constructor(data: SerializedJob, manager: JobManager) {
    super(data, manager);
    console.log("Error in: " + this.name);
    this.room = Game.rooms[data.data.name];
    console.log(data.data.name);
    console.log("Room: " + this.room);
    console.log("MangerRoomData: " + this.manager.roomData);
    console.log("Manager:" + this.manager);
    this.roomData = this.manager.roomData[this.room.name];
    console.log("RoomData: " + this.roomData);
    if (!this.room || !this.roomData) {
      console.log("Error in: " + this.name);
      console.log("Room: " + this.room);
      console.log("RoomData: " + this.roomData);
    }
  }
}
