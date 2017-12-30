import {CreepUpgrade} from "./CreepUpgrade";
import {Job} from "./Job";

export class CreepBuild extends Job {
  public type = "CreepBuild";
  public constructionSite: ConstructionSite;
  public creep: Creep;
  public run() {
    this.creep = Game.creeps[this.data.name];
    this.constructionSite = Game.getObjectById(this.data.target);
    if (!this.creep || this.constructionSite === null || this.creep.carry[RESOURCE_ENERGY] === 0) {
      this.complete();
    } else {
      const err = this.creep.build(this.constructionSite);
      console.log(err);
      switch (err) {
        case ERR_NOT_IN_RANGE:
          this.creep.moveTo(this.constructionSite);
          break;
        case ERR_RCL_NOT_ENOUGH:
          this.manager.addJobIfNotExist( "CreepUpgrade_" + this.name, CreepUpgrade, 30, {target: this.creep.room.controller.id, name: this.creep.name}, this.name);
          this.wait = true;
          break;
        default:
          break;
      }
    }
  }
}
