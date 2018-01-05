import {Job} from "./Job";
import {JobManager} from "./jobManager";

export class CreepJob extends Job {
  public creep;
  constructor(data: SerializedJob, manager: JobManager) {
    super(data, manager);
    this.creep = Game.creeps[data.data.name];
  }
}
