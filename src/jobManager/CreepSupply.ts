import {Job} from "./Job";

export class CreepSupply extends Job {
  public type = "CreepSupply";
  public creep: Creep;
  public target: StructureExtension | StructureSpawn;
  public run() {
    this.target = Game.getObjectById(this.data.target);
    this.creep = Game.creeps[this.data.name];
    if (!this.target || this.target.energyCapacity  === this.target.energy || !this.creep || this.creep.carry[RESOURCE_ENERGY] === 0) {
      this.complete();
    } else {
      if ( this.creep.transfer(this.target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        this.creep.moveTo(this.target);
      }
    }
  }
}
