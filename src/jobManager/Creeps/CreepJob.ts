import {BuildCreep} from "./BuildCreep";
import {Job} from "../Job";
import {JobManager} from "../jobManager";

export class CreepJob extends Job {
  public creep;
  constructor(data: SerializedJob, manager: JobManager) {
    super(data, manager);
    this.creep = Game.creeps[this.name];
  }
  public spawnMe(body, spawns) {
    console.log( "Used Spawnme Function: ");
    this.manager.addJobIfNotExist("BuildCreep_" + this.name, BuildCreep, this.priority - 1, {body, spawns, name: this.name}, this.name);
    console.log("Setting wait to True for: " + this.name);
    this.wait = true;
  }
  public smartMove(target) {
    this.creep.moveTo(target);
  }
}
