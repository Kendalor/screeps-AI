import {InitialBuildUpJob} from "../Managers/InitialBuildUpJob";
import {RoomJob} from "./RoomJob";

/**
 * RoomManager Class
 * Manages all owned Rooms,is initialized every tick in the Init Job.
 * Forks Jobs To generate Creeps, handle creeps and Build structures.
 */

export class RoomManager extends RoomJob {
  public type = "RoomManager";
  public run() {
    this.room = Game.rooms[this.data.name];
    this.roomData = this.manager.roomData[this.data.name];
    this.checkIfStillMyRoom();
    this.manager.addJobIfNotExist("IBU_" + this.room.name, InitialBuildUpJob, 60, {name: this.room.name});

    //IF storage does not exist use Initial BuildUp
    if (this.room.controller.my && this.room.storage) {
      this.manager.addJobIfNotExist("MiningManager_" + this.room.name, 70, 60, {name: this.room.name}, this.name);
    } else {
      this.manager.addJobIfNotExist("IBU_" + this.room.name, InitialBuildUpJob, 60, {name: this.room.name});
    }
  }

  public checkIfStillMyRoom(){
    if (!this.room || !this.roomData) {
      this.completed = true;
      console.log("Room: " + !this.room + " roomData " + !this.roomData);
      console.log("Delete: " + this.data.name + " from myRooms");
      delete Memory.myRooms[this.data.name];
      return;
    }
  }
}
