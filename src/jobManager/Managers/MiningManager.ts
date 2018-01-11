import {MineSourceJob} from "../Creeps/MineSourceJob";
import {RoomJob} from "../Rooms/RoomJob";
import {HaulerSourceJob} from "../Creeps/HaulerSourceJob";

export class MiningManager extends RoomJob {
  public type = "MiningManager";
  public run() {
    this.roomData = this.manager.roomData[this.room.name];
    const sources = this.roomData.sources;
    for ( const i in sources) {
      this.manager.addJobIfNotExist("Miner_" + sources[i].id, MineSourceJob, 70, {name: this.room.name, source: sources[i].id})
      if(this.roomData.sourceContainers[sources[i].id]) {
        const container = this.roomData.sourceContainers[sources[i].id];
        if(container) {
          if( container.structureType === STRUCTURE_CONTAINER ) {
            this.manager.addJobIfNotExist("Hauler_" + sources[i].id, HaulerSourceJob, 70, {name: this.room.name, source: sources[i].id, container: this.roomData.sourceContainers[sources[i].id].id, storage: this.room.storage.id})
          } else {
            console.log("Container for Source is Link");
          }
        }
      }
    }
  }
}
