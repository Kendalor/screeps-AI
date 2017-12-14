import {Job} from "./Job";

export class RoomManager extends Job {
  public type = "RoomManager";

  public run() {
    const room = Game.rooms[this.data.roomName];

    const harvestersPerSoruce = 3;
    let sources: Source[] = _.forEach(room.find(FIND_SOURCES));
    for(let i=0;i<harvestersPerSoruce;i++){
      sources.forEach(function(entry) {
        this.manager.addJobIfNotExist("harvest_" + i.toString() + "_" + entry.id.toString(), "HarvestJob" , 60, {source: entry.id})
      });
    }

  }
}
