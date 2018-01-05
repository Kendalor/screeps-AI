import {CreateRoomData} from "./CreateRoomData";
import {Job} from "./Job";
import {RoomManager} from "./RoomManager";

export class InitJob extends Job {
  public type= "InitJob";
  public run() {
    this.cleanMemory();
    for (const i in Game.rooms) {
      this.manager.addJob("CreateRoomData_" + i, CreateRoomData, 98, {name: i});
    }
    /*
    If Memroy.myRooms is not found add it and add every room with a spawn
    It is used to initalize the RoomManager which manages alle owned rooms with spawns
     */
    if (!Memory.myRooms) {
      Memory.myRooms = {};
      for (const i in Game.spawns) {
        console.log("Added " + Game.spawns[i].room.name + "to myRooms");
        Memory.myRooms[Game.spawns[i].room.name] = {};
      }
    }
    //Respawned? Delete Memory.myRooms
    if (Game.time % 5 === 0){
      if(Object.keys(Memory.myRooms).length === 0) {
        delete Memory.myRooms;
        delete Memory.JobManager.jobList;
        console.log("Respawn detected");
      }
    }


    for (const i in Memory.myRooms) {
      this.manager.addJob("RoomManager_" + i , RoomManager , 80 , {name: i});
    }
    this.completed = true;
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
