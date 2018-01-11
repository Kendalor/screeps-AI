import {RoomData} from "../Rooms/RoomData";
import {CreepLifetimeJob} from "./CreepLifetimeJob";

interface HaulerSourceJobData {
  container: string;
  storage: string;
  name: string;
  mode: string;
  source: string;
}

export class HaulerSourceJob extends CreepLifetimeJob {
  public type = "HaulerSourceJob";
  public data: HaulerSourceJobData;
  public source: Source;
  public container: StructureContainer;
  public roomData: RoomData;

  public init() {
    this.homeRoom = Game.rooms[this.data.name];
    this.roomData = this.manager.roomData[this.homeRoom.name];
    this.container = this.roomData.sourceContainers[this.data.source];
  }

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

  public getBody() {
    const body: string[] = [MOVE, CARRY];
    let t = true;
    while (t) {
      const cost = body.reduce(function(cost, part) { return cost + BODYPART_COST[part]; }, 0) + 100;
      if ( (cost > this.homeRoom.energyCapacityAvailable)  || (cost > 1000 )) {
        t = false;
      } else {
        body.push(MOVE, CARRY);
      }
    }
    return body;
  }

  public changeMode() {
    if (_.sum(this.creep.carry) === 0) {
      this.data.mode = "fetch";
    } else {
      this.data.mode = "deliver";
    }
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

  private fetch() {
    this.container = Game.getObjectById(this.data.container);
    if (!this.container) {
      this.complete();
      return;
    }
    const err = this.creep.withdraw(this.container, RESOURCE_ENERGY);
    switch (err) {
      case OK:
        break;
      case ERR_NOT_IN_RANGE:
        this.smartMove(this.container);
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

  private deliver() {
   const target = Game.getObjectById(this.data.storage);
   if (!target) {
      this.complete();
   } else {
     const err = this.creep.transfer(target, RESOURCE_ENERGY);
     switch (err) {
       case ERR_NOT_IN_RANGE:
         this.smartMove(target);
         break;
       case ERR_NOT_ENOUGH_RESOURCES:
         this.data.mode = "fetch";
         this.executeMode();
       default:
         this.changeMode();
         break;
     }
   }

  }
}
