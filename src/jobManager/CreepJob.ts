import {BuildCreep} from "./BuildCreep";
import {Job} from "./Job";
import {JobManager} from "./jobManager";

export class CreepJob extends Job {
  public creep;
  constructor(data: SerializedJob, manager: JobManager) {
    super(data, manager);
    this.creep = Game.creeps[data.data.name];
  }
  public spawnMe(body, spawns) {
    this.manager.addJobIfNotExist("BuildCreep_" + this.name, BuildCreep, 30, {body, spawns, name: this.name}, this.name);
    this.wait = true;
  }
  public smartMove(target) {
    this.creep.moveTo(target);
  }
}
