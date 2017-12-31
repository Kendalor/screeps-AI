import {BuildCreep} from "./BuildCreep";
import {Job} from "./Job";

export class IBUCreep extends Job {
  public type = "IBUCreep";
  public creep: Creep;
  public room: Room;
  public source: Source;
  public mode: string;
  public target: string;
  public run() {
    this.creep = Game.creeps[this.name];
    this.room = Game.rooms[this.data.name];
    if (!this.creep) {
      this.spawnMe();
    } else {
      if(!this.creep.spawning) {
        if (!this.data.mode) {
          this.changeMode();
        }
        this.executeMode();
      }
    }
  }

  public spawnMe() {
    let body = [];
    switch (this.room.energyCapacityAvailable) {
      case 300:
        body = [WORK, MOVE, CARRY, CARRY, MOVE];
        break;
      case 550:
        body = [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];
        break;
      default:
        body = [WORK, MOVE, CARRY, CARRY, MOVE];
        break;
    }
    const spawns = global.roomData[this.room.name].spawns.map(function(entry) {return entry.id; });
    this.manager.addJobIfNotExist("BuildCreep_" + this.name, BuildCreep, 30, {body, spawns, name: this.name}, this.name);
    this.wait = true;
  }

  public changeMode() {
    if (this.creep.spawning === false) {
      if (_.sum(this.creep.carry) === 0) {
        this.data.mode = "harvest";
      } else {
        if ( this.room.energyAvailable < this.room.energyCapacityAvailable ) {
          this.data.mode = "supply";
        } else {
          if ( global.roomData[this.room.name].constructionSites.length > 0) {
            this.data.mode = "build";
          } else {
            this.data.mode = "upgrade";
          }
        }
      }
    } else {
      this.data.mode = "spawning";
    }
  }

  public executeMode() {
    switch (this.data.mode) {
      case "harvest":
        this.harvest();
        break;
      case "supply":
        this.supply();
        break;
      case "build":
        this.build();
        break;
      case "upgrade":
        this.upgrade();
        break;
      default:
        this.changeMode();
        this.executeMode();
        break;
    }
  }

  public harvest() {
    if (!this.source) {
      this.source = Game.getObjectById(this.data.source);
    }
    if(_.sum(this.creep.carry) === this.creep.carryCapacity){
      this.changeMode();
      return;
    }
    const err = this.creep.harvest(this.source);
    switch (err) {
      case ERR_NOT_IN_RANGE:
        this.creep.moveTo(this.source);
        break;
      case OK:
        break;
      default:
        console.log("Error in harvest for job: " + this.name + "Err: " + err);
        break;
    }
  }

  public upgrade() {
    const controller = this.room.controller;
    if (!this.creep || !controller || this.creep.carry[RESOURCE_ENERGY] === 0) {
      this.changeMode();
      return;
    } else {
      if (this.creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        this.creep.moveTo(controller);
      }
    }
  }

  public build() {
    const target = global.roomData[this.room.name].constructionSites[0];
    const err = this.creep.build(target);
    switch (err) {
      case ERR_NOT_IN_RANGE:
        this.creep.moveTo(target);
        break;
      case ERR_RCL_NOT_ENOUGH:
        this.data.mode = "upgrade";
        break;
      default:
        this.changeMode();
        break;
    }
  }

  public supply() {
    let target: StructureExtension | StructureSpawn;
    const spawns = global.roomData[this.room.name].spawns.filter(function(entry) {return entry.energy < entry.energyCapacity; });
    const extensions = global.roomData[this.room.name].extensions.filter(function(entry) {return entry.energy < entry.energyCapacity; });
    if ( spawns.length > 0) {
      target = spawns[0];
    } else {
      target = extensions[0];
    }
    console.log("running: " + this.name);
    console.log("spawns: " + spawns);
    console.log("Extensions: " + extensions);
    console.log("Spawns bool: " + (spawns.length >0));
    console.log("Target: " + target);
    console.log("Target Bool: " + !target);
    if(target){
      console.log("target energy: " + target.energy);
    }
    if (!target || !this.creep || this.creep.carry[RESOURCE_ENERGY] === 0) {
      this.changeMode();
    } else {
      const err = this.creep.transfer(target, RESOURCE_ENERGY);
      console.log("ERr: " + err);
      switch(err){
        case ERR_NOT_IN_RANGE:
          this.creep.moveTo(target);
          break;
        case ERR_FULL:
          break;
        default:
          this.changeMode();
          break;
      }
    }
  }
}
