import {Job} from "./Job";

export class CreepHarvest extends Job{
  public type = "CreepHarvest";
  public source: Source;
  public creep: Creep;
  public run() {
    this.source = Game.getObjectById(this.data.source);
    this.creep = Game.creeps[this.data.name];
    if (this.creep.carry.energy === this.creep.carryCapacity){
      this.completed = true;
      this.manager.getJob(this.parent).wait = false;
    }
    if(this.creep.harvest(this.source) === ERR_NOT_IN_RANGE){
      this.creep.moveTo(this.source);
    }
  }
}
