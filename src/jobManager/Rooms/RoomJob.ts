import {Job} from "../Job";
import {JobManager} from "../jobManager";
import {RoomData} from "./RoomData";

export class RoomJob extends Job {
  public room: Room;
  public roomData: RoomData;
  constructor(data: SerializedJob, manager: JobManager) {
    super(data, manager);
    this.room = Game.rooms[data.data.name];
    //this.roomData = this.manager.roomData[this.room.name];
  }
}
