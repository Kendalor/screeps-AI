import {Job} from "./Job";

export class CreepUpgrade extends Job{
  public type = "CreepUpgrade";
  public creep: Creep;
  public controller: Controller;
  public run() {
    this.creep = Game.creeps[this.data.name];
    this.controller = Game.getObjectById(this.data.target);
    if(!this.creep || !this.controller || this.creep.carry[RESOURCE_ENERGY] === 0){
      this.complete();
    } else {
      if (this.creep.upgradeController(this.controller) === ERR_NOT_IN_RANGE) {
        this.creep.moveTo(this.controller);
      }
    }
  }
}
