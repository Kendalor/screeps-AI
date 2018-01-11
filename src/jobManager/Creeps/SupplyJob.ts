import {RoomData} from "../Rooms/RoomData";
import {CreepLifetimeJob} from "./CreepLifetimeJob";

interface SupplyJobData {
  storage: string;
  name: string;
  mode: string;
  target: string;
}

export class SupplyJob extends CreepLifetimeJob {
  public type = "SupplyJob";
  public data: SupplyJobData;
  public storage: StructureStorage;
  public roomData: RoomData;

  public run() {
    this.init();
    if (!this.creep) {
      const spawns = this.roomData.spawns.map(function(entry) {return entry.id; });
      const body = this.getBody();
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
  public init() {
    this.homeRoom = Game.rooms[this.data.name];
    this.roomData = this.manager.roomData[this.homeRoom.name];
    this.storage = Game.getObjectById(this.data.storage);
  }

  public executeMode() {
    switch (this.data.mode) {
      case "fetch":
        this.fetch();
        break;
      case "deliver":
        this.deliver();
        break;
      default:
        break;
    }
  }

  public changeMode() {
    if (_.sum(this.creep.carry) === 0) {
      this.data.mode = "fetch";
    } else {
      this.data.mode = "deliver";
    }
  }

  public fetch() {
    if (!this.storage) {
      this.complete();
      return;
    }
    const err = this.creep.withdraw(this.storage, RESOURCE_ENERGY);
    switch (err) {
      case OK:
        break;
      case ERR_NOT_IN_RANGE:
        this.smartMove(this.storage);
        break;
      case ERR_INVALID_TARGET:
        this.complete();
        break;
      case ERR_FULL:
        this.data.mode = "deliver";
        this.executeMode();
        break;
      default:
        console.log("Error in: " + this.name + " err: " + err);
        break;
    }
  }

  public deliver() {
    let target = Game.getObjectById(this.data.target) as Structure;
    if (!target) {
      target = this.creep.pos.findClosestByRange(this.roomData.supplyTargets);
      if(target) {
        this.data.target = target.id;
      }
    }
    const err = this.creep.transfer(target, RESOURCE_ENERGY);
    switch (err) {
      case ERR_NOT_IN_RANGE:
        this.smartMove(target);
        break;
      case ERR_NOT_ENOUGH_RESOURCES:
        this.data.mode = "fetch";
        this.executeMode();
      case ERR_FULL:
        this.data.target = undefined;
        this.executeMode();
      default:
        this.changeMode();
        break;
    }
  }
  public getBody() {
    const body: string[] = [MOVE, CARRY, CARRY];
    let t = true;
    while (t) {
      const cost = body.reduce(function(cost, part) { return cost + BODYPART_COST[part]; }, 0) + 150;
      if ( (cost > this.homeRoom.energyCapacityAvailable)  || (cost >   1200)) {
        t = false;
      } else {
        body.push(MOVE, CARRY, CARRY);
      }
    }
    return body;
  }
}
