import {JobManager} from "../jobManager";
import {RoomData} from "../Rooms/RoomData";
import {CreepLifetimeJob} from "./CreepLifetimeJob";

interface MinerSourceJobData {
  source: string;
  container: string | undefined;
  name: string;
  constructionSite: string | undefined;
  mode: string;
}

export class MineSourceJob extends CreepLifetimeJob {
  public type = "MineSourceJob";
  public data: MinerSourceJobData;
  public source: Source;
  public container: StructureContainer;
  public roomData: RoomData;
  constructor(data: SerializedJob, manager: JobManager) {
    super(data, manager);
    this.source = Game.getObjectById(this.data.source);
  }
  public init() {
    this.homeRoom = Game.rooms[this.data.name];
    this.roomData = this.manager.roomData[this.homeRoom.name];
    this.container = this.roomData.sourceContainers[this.source.id];
  }

  public getBody() {
    const body: string[] = [MOVE, CARRY, WORK, WORK];
    let t = true;
    while (t) {
      const cost = body.reduce(function(cost, part) { return cost + BODYPART_COST[part]; }, 0) + 100;
      if ( (cost > this.homeRoom.energyCapacityAvailable)  || (cost > 700 )) {
        t = false;
      } else {
        body.push(WORK);
      }
    }
    return body;
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
  public executeMode() {
      switch ( this.data.mode) {
        case "spawning":
          this.changeMode();
          break;
        case "harvest":
          this.harvest();
          break;
        case "build":
          this.build();
          break;
        case "idle":
          this.idle();
          break;
        case "repair":
          this.repair();
          break;
        case "transfer":
          this.transfer();
          break;
        default:
          this.changeMode();
          break;
      }
  }

  public changeMode() {
    if (this.creep.spawning === false) {
      if (_.sum(this.creep.carry) === 0) {
        this.data.mode = "harvest";
        return;
      }
      if (this.container.hits < this.container.hitsMax - 10000) {
        this.data.mode = "repair";
        return;
      }
      if (_.sum(this.creep.carry) > 0) {
        this.data.mode = "transfer";
        return;
      }
    } else {
      this.data.mode = "spawning";
      return;
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
        this.smartMove(this.source);
        break;
      case OK:
        break;
      case ERR_NOT_ENOUGH_RESOURCES:
        this.data.mode = "idle";
        break;
      default:
        console.log("Error in harvest for job: " + this.name + "Err: " + err);
        break;
    }
  }

  public repair() {
    const container = Game.getObjectById(this.data.container);
    if (!container) {
      delete this.data.container;
      this.changeMode();
    } else {
      this.creep.repair(this.container);
    }
  }

  public idle() {
    if (this.source.energy > 0) {
      this.changeMode();
    }
  }

  public build() {
    let target = Game.getObjectById(this.data.constructionSite);
    if (!target) {
      delete this.data.constructionSite;
      const container = this.source.pos.findInRange(this.roomData.containers,2).filter( (i) => i.structureType === (STRUCTURE_CONTAINER || STRUCTURE_LINK) );
      if(container.length > 0) {
        this.roomData.buildSourceContainers();
        this.container = this.roomData.sourceContainers[this.source.id];
        this.data.container = this.roomData.sourceContainers[this.source.id];
        this.data.mode = "harvest";
      }
      const constructionSites = this.source.pos.findInRange(this.roomData.constructionSites, 1).filter((i) => i.structureType === (STRUCTURE_CONTAINER || STRUCTURE_LINK));
      if (constructionSites.length > 0) {
        target = constructionSites[0];
        this.data.constructionSite = constructionSites[0].id;
      } else {
        const err = this.creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
        if (err === OK) {
          this.data.constructionSite = this.creep.pos.lookFor(LOOK_CONSTRUCTION_SITES)[0];
        }
      }
    } else {
      const err = this.creep.build(target);
      switch (err) {
        case OK:
          break;
        case ERR_NOT_ENOUGH_RESOURCES:
          this.data.mode = "harvest";
          break;
        case ERR_INVALID_TARGET:

        default:
          console.log("Error for: " + this.creep.name + " with err: " + err);
      }
    }
  }
  public transfer() {
    const container = Game.getObjectById(this.data.container);
    if (!container) {
      this.data.mode = "build";
    } else {
      const err = this.creep.transfer(container, RESOURCE_ENERGY);
      console.log(err);
      switch (err) {
        case ERR_NOT_IN_RANGE:
          this.smartMove(container);
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
