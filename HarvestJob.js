import {Job} from "../src/jobManager/Job";
interface HarvestJobData {
  name: string;
  source: string;
}

export class HarvestJob extends Job {
  public data: HarvestJobData;
  static run() {
    const creep: Creep = Game.getObjectById(this.data.name);
    if (!creep) {
      return;
    }

    if (creep.carry.energy === 0) {
      const sources: Source = Game.getObjectById(this.data.source);
      if (creep.harvest(sources[0]) === ERR_NOT_IN_RANGE) {
        creep.moveTo(sources[0], {visualizePathStyle: {stroke: "#ffaa00"}});
      }
    } else {
      const targets: Structure[] = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
          return (structure.structureType === STRUCTURE_EXTENSION || structure.structureType === STRUCTURE_SPAWN) &&
            structure.energy < structure.energyCapacity;
        }
      });
      if (targets.length > 0) {
        if (creep.transfer(targets[0], RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(targets[0], {visualizePathStyle: {stroke: "#ffffff"}});
        }
      } else {
        if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
          creep.moveTo(creep.room.controller, {visualizePathStyle: {stroke: "#ffffff"}});
        }
      }
    }
  }

}
