
export class RoomData {
  get numConstructionSites(): number {
    if (!this.room.memory._numConstructionSites) {
      this.room.memory._numConstructionSites = Object.keys(Game.constructionSites).length;
    }
    this._numConstructionSites = this.room.memory._numConstructionSites;
    return this._numConstructionSites;
  }
  public get repairDefense(): any[] {
    if (!this._repairDefense) {
      this._repairDefense = this.structures.filter(function(entry) {return ((entry.hits < entry.hitsMax * 0.1)  && (entry.structureType === (STRUCTURE_RAMPART || STRUCTURE_WALL))); });
    }
    return this._repairDefense;
  }
  public get myStructures(): Structure[] {
    if (!this._myStructures) {
       if (!Memory.rooms[this.room.name]._myStructures) {
         this.buildMyStructures();
       } else {
         const temp = this.deserialize(Memory.rooms[this.room.name]._myStructures);
         if (temp[1]) {
           this._myStructures = temp[0] as Structure[];
         } else {
           this.buildMyStructures();
         }
       }
     }
    return this._myStructures;
  }
  public get structures(): Structure[] {
     if (!this._structures) {
       if (!Memory.rooms[this.room.name]._structures) {
         this.buildStructures();
       } else {
         const temp = this.deserialize(Memory.rooms[this.room.name]._structures);
         if (temp[1]) {
           this._structures = temp[0] as Structure[];
         } else {
           this.buildStructures();
         }
       }
     }
     if (!this._structures) {
      this.buildStructures();
    }
     return this._structures;
  }
  public get supplyTargets(): any[] {
    if (!this._supplyTargets) {
      let list = [];
      list = list.concat(this.extensions.filter(function(entry) {return (entry.energy < entry.energyCapacity); } ) ) ;
      list = list.concat(this.spawns.filter(function(entry) {return (entry.energy < entry.energyCapacity); } ) ) ;
      this._supplyTargets = list;
    }
    return this._supplyTargets;
  }
  public get repairBuildings(): any[] {
    if (!this._repairBuildings) {
      const list = [];
      list.concat(this.structures.filter(function(entry) {return (entry.hits < entry.hitsMax) && ((entry.structureType !== (STRUCTURE_WALL || STRUCTURE_RAMPART ))) ; }));
    }
    return this._repairBuildings;
  }
  public get timeStamp(): number {
    return this._timeStamp;
  }
  public get roads(): StructureRoad[] {
    if (!this._roads) {
      if (!Memory.rooms[this.room.name]._roads) {
        this.buildRoads();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._roads);
        if (temp[1]) {
          this._roads = temp[0] as StructureRoad[];
        } else {
          this.buildRoads();
        }
      }
    }
    return this._roads;
  }
  public get mineral(): Mineral[] {
    if (!this._mineral) {
      if (!Memory.rooms[this.room.name]._mineral) {
        this.buildMineral();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._mineral);
        if (temp[1]) {
          this._mineral = temp[0] as Mineral[];
        } else {
          this.buildMineral();
        }
      }
    }
    return this._mineral;
  }
  public get sourceSlots(): { [p: string]: number } {
    if (!this._sourceSlots) {
      if (!this.room.memory._sourceSlots) {
        this.buildSourceSlots();
      } else {
        this._sourceSlots = this.room.memory._sourceSlots;
      }
    }
    return this._sourceSlots;
  }
  public get constructionSites(): ConstructionSite[] {
    if (!this._constructionSites) {
      if (!Memory.rooms[this.room.name]._constructionSites) {
        this.buildConstructionSites();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._constructionSites);
        if (temp[1]) {
          this._constructionSites = temp[0] as ConstructionSite[];
        } else {
          this.buildConstructionSites();
        }
      }
    }
    return this._constructionSites;
  }
  public get sources(): Source[] {
    if (!this._sources) {
      if (!Memory.rooms[this.room.name]._sources) {
        this.buildSources();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._sources);
        if (temp[1]) {
          this._sources = temp[0] as Source[];
        } else {
          this.buildSources();
        }
      }
    }
    return this._sources;
  }
  public get ramparts(): StructureRampart[] {
    if (!this._ramparts) {
      if (!Memory.rooms[this.room.name]._ramparts) {
        this.buildRamparts();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._ramparts);
        if (temp[1]) {
          this._ramparts = temp[0] as StructureRampart[];
        } else {
          this.buildRamparts();
        }
      }
    }
    return this._ramparts;
  }
  public get walls(): StructureWall[] {
    if (!this._walls) {
      if (!Memory.rooms[this.room.name]._walls) {
        this.buildWalls();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._walls);
        if (temp[1]) {
          this._walls = temp[0] as StructureWall[];
        } else {
          this.buildWalls();
        }
      }
    }
    return this._walls;
  }
  public get towers(): StructureTower[] {
    if (!this._towers) {
      if (!Memory.rooms[this.room.name]._towers) {
        this.buildTowers();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._towers);
        if (temp[1]) {
          this._towers = temp[0] as StructureTower[];
        } else {
          this.buildTowers();
        }
      }
    }
    return this._towers;
  }
  public get links(): StructureLink[] {
    if (!this._links) {
      if (!Memory.rooms[this.room.name]._links) {
        this.buildLinks();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._links);
        if (temp[1]) {
          this._links = temp[0] as StructureLink[];
        } else {
          this.buildLinks();
        }
      }
    }
    return this._links;
  }
  public get containers(): StructureContainer[] {
    if (!this._containers) {
      if (!Memory.rooms[this.room.name]._containers) {
        this.buildContainers();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._containers);
        if (temp[1]) {
          this._containers = temp[0] as StructureContainer[];
        } else {
          this.buildContainers();
        }
      }
    }
    return this._containers;
  }
  public get spawns(): StructureSpawn[] {
    if (!this._spawns) {
      if (!Memory.rooms[this.room.name]._spawns) {
        this.buildSpawns();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._spawns);
        if (temp[1]) {
          this._spawns = temp[0] as StructureSpawn[];
        } else {
          this.buildSpawns();
        }
      }
    }
    return this._spawns;
  }
  public get extensions(): StructureExtension[] {
    if (!this._extensions) {
      if (!Memory.rooms[this.room.name]._extensions) {
        this.buildExtensions();
      } else {
        const temp = this.deserialize(Memory.rooms[this.room.name]._extensions);
        if (temp[1]) {
          this._extensions = temp[0] as StructureExtension[];
        } else {
          this.buildExtensions();
        }
      }
    }
    return this._extensions;
  }

  public fields = ["_spawns", "_extensions", "_containers", "_links", "_towers", "_walls", "_ramparts", "sources", "_mineral", "extractor", "_constructionSites", "_roads"];
  public room: Room;
  private _numConstructionSites: number ;
  private _structures: Structure[];
  private _myStructures: Structure[];
  private _spawns: StructureSpawn[];
  private _extensions: StructureExtension[];
  private _containers: StructureContainer[];
  private _links: StructureLink[];
  private _towers: StructureTower[];
  private _walls: StructureWall[];
  private _ramparts: StructureRampart[];
  private _sources: Source[];
  private _mineral: Mineral[];
  private _sourceSlots: {[key: string]: number};
  private _constructionSites: ConstructionSite[];
  private _roads: StructureRoad[];
  private _timeStamp: number;
  private _supplyTargets: any[];
  private _repairBuildings: any[];
  private _repairDefense: any[];

  constructor(name: string) {
    this.room = Game.rooms[name];
    if (!Memory.rooms) {
      Memory.rooms = {};
    }
    if (!Memory.rooms[this.room.name]) {
      Memory.rooms[this.room.name] = {};
    }
    if (!global.roomData[this.room.name]) {
      global.roomData[this.room.name] = {};
      global.roomData[this.room.name] = this;
    }
    if (Object.keys(Game.constructionSites).length !== this.numConstructionSites) {
      this.room.memory._numConstructionSites = Object.keys(Game.constructionSites).length;
      this.refreshBuildings();
    }
  }

  public seralize(items: Structure[] | Source[] | Mineral[] | ConstructionSite[]): string[] {
    const out = [];
    for (const i in items) {
      out.push(items[i].id);
    }
    return out;
  }
  public deserialize<T>(items: string[]): [T[], boolean] {
    const out = [];
    let success = true;
    for (const i in items) {
      const item = Game.getObjectById(items[i]);
      if (!item || item === null) {
      success = false;
      }
      out.push(Game.getObjectById(items[i]));
    }
    if (items.length === 0) {
      success = false;
    }
    return [out, success];
  }

  public buildSpawns(): void {
    this._spawns = _.filter(this.myStructures, function(entry) {
      return (entry.structureType === STRUCTURE_SPAWN);
    }) as StructureSpawn[];
    Game.rooms[this.room.name].memory._spawns = this.seralize(this._spawns);
  }

  public buildExtensions(): void {
    this._extensions = _.filter(this.myStructures, function(entry) {
      return (entry.structureType === STRUCTURE_EXTENSION);
    }) as StructureExtension[];
    Game.rooms[this.room.name].memory._extensions = this.seralize(this._extensions);
  }

  public buildContainers(): void {
    this._containers = _.filter(this.structures, function(entry) {
      return (entry.structureType === STRUCTURE_CONTAINER);
    }) as StructureContainer[];
    Game.rooms[this.room.name].memory._containers = this.seralize(this._containers);
  }

  public buildLinks(): void {
    this._links = _.filter(this.myStructures, function(entry) {
      return (entry.structureType === STRUCTURE_LINK);
    }) as StructureLink[];
    Game.rooms[this.room.name].memory._links = this.seralize(this._links);
  }

  public buildTowers(): void {
    this._towers = _.filter(this.myStructures, function(entry) {
      return (entry.structureType === STRUCTURE_TOWER);
    }) as StructureTower[];
    Game.rooms[this.room.name].memory._towers = this.seralize(this._towers);
  }

  public buildWalls(): void {
    this._walls = _.filter(this.structures, function(entry) {
      return (entry.structureType === STRUCTURE_WALL);
    }) as StructureWall[];
    Game.rooms[this.room.name].memory._walls = this.seralize(this._walls);
  }

  public buildRamparts(): void {
    this._ramparts = _.filter(this.myStructures, function(entry) {
      return (entry.structureType === STRUCTURE_RAMPART);
    }) as StructureRampart[];
    Game.rooms[this.room.name].memory._ramparts = this.seralize(this._ramparts);
  }

  public buildSources(): void {
    this._sources = this.room.find(FIND_SOURCES) as Source[];
    Game.rooms[this.room.name].memory._sources = this.seralize(this._sources);
  }

  public buildMineral(): void {
    this._mineral = this.room.find(FIND_MINERALS) as Mineral[];
    Game.rooms[this.room.name].memory._mineral = this.seralize(this._mineral);
  }
  public buildSourceContainers(): void {
    //TODO
  }

  public buildSourceSlots(): void {
    this._sourceSlots = this.calculateSourceSlots();
    Game.rooms[this.room.name].memory._sourceSlots = this._sourceSlots;
  }
  public buildConstructionSites(): void {
    this._constructionSites = this.room.find(FIND_CONSTRUCTION_SITES) as ConstructionSite[];
    Game.rooms[this.room.name].memory._constructionSites = this.seralize(this._constructionSites);
  }
  public buildRoads(): void {
    this._roads = _.filter(this.structures, function(entry) {
      return (entry.structureType === STRUCTURE_ROAD);
    }) as StructureRoad[];
    Game.rooms[this.room.name].memory._roads = this.seralize(this._roads);
  }

  public updateTimestamp(): void {
    this._timeStamp = Game.time;
  }

  public calculateSourceSlots() {
    const sourceSlots = {} as { [key: string]: number };
    for (const i in this.sources) {
      let count = 0;
      for (let x = -1; x < 2; x++) {
        for (let y = -1; y < 2; y++) {
          const terrain = this.room.lookForAt(LOOK_TERRAIN, this.sources[i].pos.x + x, this.sources[i].pos.y + y)[0];
          if (terrain !== "wall" && !(x === 0 && y === 0)) {
            count = count + 1;
          }
        }//Check for walls around source
      }
      sourceSlots[this.sources[i].id] = count;
    }
    return sourceSlots;
  }

  private buildStructures() {
    this._structures = this.room.find(FIND_STRUCTURES);
    Game.rooms[this.room.name].memory._structures = this.seralize(this._structures);
  }

  private buildMyStructures() {
    this._myStructures = this.room.find(FIND_MY_STRUCTURES);
    Game.rooms[this.room.name].memory._myStructures = this.seralize(this._myStructures);

  }

  private refreshBuildings() {
    this.buildStructures();
    this.buildMyStructures();
    this.buildExtensions();
    this.buildSpawns();
    this.buildContainers();
    this.buildLinks();
    this.buildTowers();
    this.buildWalls();
    this.buildRamparts();
    this.buildRoads();
    this.buildConstructionSites();
    this.buildSourceContainers();
  }
}
