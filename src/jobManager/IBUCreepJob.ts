import {BuildCreep} from "./BuildCreep";
import {Job} from "./Job";

export class IBUCreep extends Job {
  public type = "IBUCreep";
  public creep: Creep;
  public room: Room;
  public source: Source;
  public run() {
    this.creep = Game.creeps[this.name];
    this.room = Game.rooms[this.data.name];
    if (!this.creep) {
      const body = [WORK, MOVE, CARRY, CARRY, MOVE];
      const spawns = global.roomData[this.room.name].spawns.map(function(entry) {return entry.id;});
      this.manager.addJobIfNotExist("BuildCreep_" + this.name, BuildCreep, 70, {body, spawns, name: this.name}, this.name);
    }
    console.log("Creep rdy, rdy to run behavior!");

  }
}
