import {Job} from "./Job";

export class CreepSupply extends Job {
  public type = "CreepSupply";
  public creep: Creep;
  public target: StructureExtension | StructureSpawn;
  public run() {
    this.target = Game.getObjectById(this.data.target);
    this.creep = Game.creeps[this.data.name];
    console.log("Supply Job: "+ this.name);
    console.log(!this.target);
    console.log(this.target.energyCapacity  === this.target.energy);
    console.log(!this.creep);
    console.log(this.creep.carry[RESOURCE_ENERGY] === 0);
    console.log(this.target);
    console.log(!this.target || this.target.energyCapacity  === this.target.energy || !this.creep || this.creep.carry[RESOURCE_ENERGY] === 0);
    if (!this.target || this.target.energyCapacity  === this.target.energy || !this.creep || this.creep.carry[RESOURCE_ENERGY] === 0) {
      this.complete();
    } else {
      console.log(this.creep.transfer(this.target, RESOURCE_ENERGY));
      if ( this.creep.transfer(this.target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        this.creep.moveTo(this.target);
      }
    }
  }
}
