import {CreepJob} from "./CreepJob";
import {RoomData} from "../Rooms/RoomData";

export class IBUCreep extends CreepJob {
  public type = "IBUCreep";
  public room: Room;
  public source: Source;
  public mode: string;
  public target: string;
  public roomData: RoomData;
  public run() {
    this.room = Game.rooms[this.data.name];
    this.roomData = this.manager.roomData[this.room.name];
    if (!this.creep) {
      console.log("Did Not found :");
      console.log(this.creep.name);
      console.log("Spawning");
      const spawns = this.roomData.spawns.map(function(entry) {return entry.id; });
      const body = this.getBody();
      console.log("Spawning");
      this.spawnMe(body, spawns);
    } else {
      if (!this.creep.spawning) {
        if (!this.data.mode) {
          this.changeMode();
        }
        this.executeMode();
      }
    }
  }

  public getBody() {
    const body: string[] = [];
    let t = true;
    while (t) {
      if (body.reduce(function(cost, part) {
          return cost + BODYPART_COST[part];
        }, 0) + 200 > this.room.energyCapacityAvailable) {
        t = false;
      } else {
        body.push(MOVE, CARRY, WORK);
      }
    }
    return body;
  }

  public changeMode() {
    if (this.creep.spawning === false) {
      if (_.sum(this.creep.carry) === 0) {
        this.data.mode = "harvest";
      } else {
        if ( this.room.energyAvailable < this.room.energyCapacityAvailable ) {
          this.data.mode = "supply";
        } else {
          if( this.roomData.repairBuildings.length > 0){
            this.data.mode = "repair";
          } else {
            if ( this.roomData.constructionSites.length > 0) {
              this.data.mode = "build";
            } else {
              this.data.mode = "upgrade";
            }
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
      case "repair":
        this.repair();
      default:
        this.changeMode();
        break;
    }
  }
  public repair(): void {
    const repairTarget: Structure = this.creep.pos.findClosestByRange(this.roomData.repairBuildings);
    const err = this.creep.repair(repairTarget);
    switch(err) {
      case ERR_NOT_IN_RANGE:
        this.smartMove(repairTarget);
        break;
      case OK:
        break;
      case ERR_NOT_ENOUGH_RESOURCES:
        this.data.state = "harvest";
        this.executeMode();
        break;
      case ERR_INVALID_TARGET:
        this.changeMode();
        break;
      default:
        console.log("Error in harvest for job: " + this.name + "Err: " + err);
        break;
    }
  }

  public harvest() {
    if (!this.source) {
      this.source = Game.getObjectById(this.data.source);
    }
    if (_.sum(this.creep.carry) === this.creep.carryCapacity) {
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
        this.smartMove(controller);
      }
    }
  }

  public build() {
    const target = this.roomData.constructionSites[0];
    const err = this.creep.build(target);
    switch (err) {
      case ERR_NOT_IN_RANGE:
        this.smartMove(target);
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
    const target = this.creep.pos.findClosestByRange(this.roomData.supplyTargets);
    if (!target || !this.creep || (this.creep.carry[RESOURCE_ENERGY] === 0)) {
      this.changeMode();
    } else {
      const err = this.creep.transfer(target, RESOURCE_ENERGY);
      switch (err) {
        case ERR_NOT_IN_RANGE:
          this.smartMove(target);
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
