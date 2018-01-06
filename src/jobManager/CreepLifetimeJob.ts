import {CreepJob} from "./CreepJob";
import {JobManager} from "./jobManager";
import {BuildCreep} from "./BuildCreep";

export class CreepLifetimeJob extends CreepJob {
  public spawns: string[];
  public homeRoom: Room;
  constructor(data: SerializedJob, manager: JobManager) {
    super(data, manager);
    this.homeRoom = Game.rooms[data.data.name];
  }

  public spawnMe(body, spawns) {
    this.manager.addJobIfNotExist("BuildCreep_" + this.name, BuildCreep, 30, {body, spawns, name: this.name}, this.name);
    this.wait = true;
  }
}
