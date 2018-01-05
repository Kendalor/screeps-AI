import {CreepJob} from "./CreepJob";
import {JobManager} from "./jobManager";

export class CreepLifetimeJob extends CreepJob {
  public spawns: string[];
  public homeRoom: Room;
  constructor(data: SerializedJob, manager: JobManager) {
    super(data, manager);
    this.homeRoom = Game.rooms[data.data.name];
  }

}
