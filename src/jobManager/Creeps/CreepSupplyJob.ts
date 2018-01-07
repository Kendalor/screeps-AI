import {Job} from "../Job";

export class CreepSupply extends Job {
  public type = "CreepSupply";
  public creep: Creep;
  public target: StructureExtension | StructureSpawn;
  public run() {
    console.log("Executing: " + this.name);
    this.target = Game.getObjectById(this.data.target);
    this.creep = Game.creeps[this.data.name];
    console.log("Supply Job: " + this.name);
    console.log("Target: " + this.target);
    console.log("Target energy Capacity: " + this.target.energyCapacity);
    console.log("Target Energy: " + this.target.energy);
    console.log("ENergy Bool: " + (this.target.energyCapacity  === this.target.energy));
    console.log("Creep: " + this.creep);
    console.log("Creep energy: " + this.creep.carry[RESOURCE_ENERGY]);
    console.log("Creep Energy Bool: " + (this.creep.carry[RESOURCE_ENERGY] === 0));
    console.log("Bool: " + !this.target || (this.target.energyCapacity  === this.target.energy) || !this.creep || (this.creep.carry[RESOURCE_ENERGY] === 0));
    if (!this.target || this.target.energyCapacity  === this.target.energy || !this.creep || this.creep.carry[RESOURCE_ENERGY] === 0) {
      console.log("Bool True nonetheless");
      this.complete();
    } else {
      const err = this.creep.transfer(this.target, RESOURCE_ENERGY);
      console.log(err);
      if ( err === ERR_NOT_IN_RANGE) {
        this.creep.moveTo(this.target);
      } else {
        console.log(err);
      }
    }
  }
}
