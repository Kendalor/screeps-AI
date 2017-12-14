import {Job} from "./Job";
import {RoomManager} from "./RoomManager";

export class InitJob extends Job {
  public type= "InitJob";
  public run() {
    this.cleanMemory();

  }

  public cleanMemory() {
    for (const name in Memory.creeps) {
      if (!Game.creeps[name]) {
        delete Memory.creeps[name];
        console.log("Clearing non-existing creep memory:", name);
      }
    }
  }

  public startRoomManager() {
    _.forEach(Game.rooms, function(entry) {
      this.manager.addJob("RoomManager_" + entry.name, RoomManager, 90, {name: entry.name});
    });
  }

}
