import {InitialBuildUpJob} from "../Managers/InitialBuildUpJob";
import {RoomJob} from "./RoomJob";
import {MiningManager} from "../Managers/MiningManager";
import {SupplyJob} from "../Creeps/SupplyJob";

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

    //IF storage does not exist use Initial BuildUp
    this.manager.addJobIfNotExist("IBU_" + this.room.name, InitialBuildUpJob, 60, {name: this.room.name}, this.name);
    if (this.room.controller.my && this.room.storage) {
      this.manager.addJobIfNotExist("MiningManager_" + this.room.name, MiningManager, 60, {name: this.room.name}, this.name);
    }
    if (this.room.storage.store[RESOURCE_ENERGY] < 5000) {
      this.manager.addJobIfNotExist("IBU_" + this.room.name, InitialBuildUpJob, 60, {name: this.room.name}, this.name);
    } else {
      console.log("Adding Supply Job");
      this.manager.addJobIfNotExist("Supply_" + this.room.name, SupplyJob, 71, {name: this.room.name, storage: this.room.storage.id}, this.name);
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
