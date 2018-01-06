import {Job} from "../Job";

export class CreepHarvest extends Job{
  public type = "CreepHarvest";
  public source: Source;
  public creep: Creep;
  public run() {
    this.source = Game.getObjectById(this.data.source);
    this.creep = Game.creeps[this.data.name];
    if (!this.creep || !this.source ||_.sum(this.creep.carry) === this.creep.carryCapacity){
      this.complete();
    } else {
      if(this.creep.harvest(this.source) === ERR_NOT_IN_RANGE){
        this.creep.moveTo(this.source);
      }
    }
  }
}
