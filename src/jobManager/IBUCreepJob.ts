import {BuildCreep} from "./BuildCreep";
import {CreepBuild} from "./CreepBuild";
import {CreepHarvest} from "./CreepHarvest";
import {CreepSupply} from "./CreepSupply";
import {CreepUpgrade} from "./CreepUpgrade";
import {Job} from "./Job";

export class IBUCreep extends Job {
  public type = "IBUCreep";
  public creep: Creep;
  public room: Room;
  public source: Source;
  public run() {
    this.creep = Game.creeps[this.name];
    this.room = Game.rooms[this.data.name];
    if (!this.creep) {
      let body = [];
      switch (this.room.energyCapacityAvailable) {
        case 300:
              body = [WORK, MOVE, CARRY, CARRY, MOVE];
        case 550:
              body = [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];
        default:
              body = [WORK, MOVE, CARRY, CARRY, MOVE];
      }
      const spawns = global.roomData[this.room.name].spawns.map(function(entry) {return entry.id; });
      this.manager.addJobIfNotExist("BuildCreep_" + this.name, BuildCreep, 70, {body, spawns, name: this.name}, this.name);
      this.wait = true;
    } else {
      if (this.creep.spawning === false) {
        if (_.sum(this.creep.carry) === 0) {
          console.log( "Adding Harvest Job");
          this.manager.addJobIfNotExist( "CreepHarvest_" + this.name, CreepHarvest, 30, {source: this.data.source, name: this.name}, this.name);
          this.wait = true;
          console.log(this.name + ": Added Harvest Job: " + "CreepHarvest_" + this.name);
          this.data.lastJob="CreepHarvest_" + this.name;
        } else {
          if ( this.room.energyAvailable < this.room.energyCapacityAvailable ) {
            let target: Structure;
            const spawns = global.roomData[this.room.name].spawns.filter(function(entry) {return entry.energy < entry.energyCapacity; });
            const extensions = global.roomData[this.room.name].extensions.filter(function(entry) {return entry.energy < entry.energyCapacity; });
            if ( spawns.length > 0) {
              target = spawns[0];
            } else {
              target = extensions[0];
            }
            console.log(this.name + ": Added Supply Job: " + "CreepSupply_" + this.name);
            this.manager.addJobIfNotExist( "CreepSupply_" + this.name, CreepSupply, 30, {target: target.id, name: this.name}, this.name);
            this.wait = true;
            this.data.lastJob="CreepSupply_" + this.name;
          } else {
            if ( global.roomData[this.room.name].constructionSites.length > 0) {
                const target = global.roomData[this.room.name].constructionSites[0];
                this.manager.addJobIfNotExist( "CreepBuild_" + this.name, CreepBuild, 30, {target: target.id, name: this.name}, this.name);
                this.wait = true;
                console.log(this.name + ": Added Build Job: " + "CreepBuild_" + this.name);
                this.data.lastJob="CreepBuild_" + this.name;
            } else {
              this.manager.addJobIfNotExist( "CreepUpgrade_" + this.name, CreepUpgrade, 30, {target: this.room.controller.id, name: this.name}, this.name);
              this.wait = true;
              console.log(this.name + ": Added Upgrade Job: " + "CreepUpgrade_" + this.name);
              this.data.lastJob="CreepUpgrade_" + this.name;
            }
          }
        }
      }
    }
  }
}
