import {MineSourceJob} from "../Creeps/MineSourceJob";
import {RoomJob} from "../Rooms/RoomJob";

export class MiningManager extends RoomJob {
  public type = "MiningManager";
  public run() {
    const sources = this.roomData.sources;
    for ( const i in sources) {
      this.manager.addJobIfNotExist("Miner_" + sources[i].id, MineSourceJob, 70, {name: this.room.name, source: sources[i].id});
    }
  }
}
