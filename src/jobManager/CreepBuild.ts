import {Job} from "./Job";

export class CreepBuild extends Job {
  public type = "CreepBuild";
  public constructionSite: ConstructionSite;
  public creep: Creep;
  public run() {
    this.creep = Game.creeps[this.data.name];
    this.constructionSite = Game.getObjectById(this.data.target);
    console.log("Build Job: " + this.name);
    console.log("Creep: " + this.creep);
    console.log("ConstructionSite: " + this.constructionSite);
    console.log("Bool: " + !this.creep || !this.constructionSite || this.creep.carry[RESOURCE_ENERGY] === 0);
    if (!this.creep || this.constructionSite === null || this.creep.carry[RESOURCE_ENERGY] === 0) {
      this.complete();
    } else {
      if (this.creep.build(this.constructionSite) === ERR_NOT_IN_RANGE) {
        this.creep.moveTo(this.constructionSite);
      }
    }
  }
}
