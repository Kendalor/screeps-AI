import {Harvest} from "../HarvestJob";
import {Upgrade} from "../Upgrade";
import {Job} from "./Job";
import {JobManager} from "./jobManager";

export class RunCreeps extends Job {
  public type= "RunCreeps";
  constructor(data: SerializedJob, manager: JobManager) {
    super(data,manager);
  }

  public run() {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (creep.memory.role === "harvester") {
        Harvest.run(creep);
      }
      if (creep.memory.role === "upgrader") {
        Upgrade.run(creep);
      }
    }
    this.completed = true;
  }
}
