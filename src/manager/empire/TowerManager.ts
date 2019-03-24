export class TowerManager {
    public towerList: StructureTower[];
    public minStructureHits: number = 1000;
    public WHITELIST: {[index: string]: boolean} = {'Kendalor' : true};
    constructor(room: Room){
        this.towerList = room.find(FIND_MY_STRUCTURES).filter( (i) => i.structureType === STRUCTURE_TOWER) as StructureTower[];
        
    }
    public run(): void {
        if(this.towerList.length > 0) {
            this.runLegacy();
        }
    }

    public runLegacy(): void {
        for(const i in this.towerList){
          if(this.towerList[i] !== null) {
            if (!this.towerList[i].room.memory.structureHitsMin || this.towerList[i].room.memory.structureHitsMin < this.minStructureHits) {
              this.towerList[i].room.memory.structureHitsMin === this.minStructureHits;
            }
            var minHits = this.towerList[i].room.memory.structureHitsMin;
            var closestHostile = this.towerList[i].pos.findClosestByRange(FIND_HOSTILE_CREEPS,{filter: (hostile) =>
              this.WHITELIST[hostile.owner.username] === undefined 
              && hostile.pos.x > 1 && hostile.pos.y > 1 && hostile.pos.x < 48 && hostile.pos.y < 48 
              && hostile.body.filter((body) => body.type === ATTACK || body.type === RANGED_ATTACK).length > 0
            })
            if(closestHostile) {
                this.towerList[i].attack(closestHostile);
            }else if(this.towerList[i].room.energyAvailable == this.towerList[i].room.energyCapacityAvailable){
              var closestDamagedStructure = this.towerList[i].pos.findClosestByRange(FIND_STRUCTURES, {
                  filter: (structure) => (structure.hits < structure.hitsMax-1000 && structure.structureType != STRUCTURE_RAMPART && structure.structureType != STRUCTURE_WALL)
              });
              if(!closestDamagedStructure){
                closestDamagedStructure = this.towerList[i].pos.findClosestByRange(FIND_STRUCTURES, {
                  filter: (structure) => (structure.hits < this.minStructureHits && (structure.structureType === STRUCTURE_RAMPART))// && structure.structureType != STRUCTURE_WALL)
                });
                minHits = this.minStructureHits;
              }
              if(!closestDamagedStructure){
                closestDamagedStructure = this.towerList[i].pos.findClosestByRange(FIND_STRUCTURES, {
                  filter: (structure) => (structure.hits < this.minStructureHits && (structure.structureType === STRUCTURE_WALL))// && structure.structureType != STRUCTURE_WALL)
                });
                minHits = this.minStructureHits;
              }
              if(!closestDamagedStructure){
                closestDamagedStructure = this.towerList[i].pos.findClosestByRange(FIND_STRUCTURES, {
                  filter: (structure) => (structure.hits < this.towerList[i].room.memory.structureHitsMin && structure.hits < structure.hitsMax-5000 && (structure.structureType == STRUCTURE_RAMPART))// && structure.structureType != STRUCTURE_WALL)
                });
              }
              if(!closestDamagedStructure){
                closestDamagedStructure = this.towerList[i].pos.findClosestByRange(FIND_STRUCTURES, {
                  filter: (structure) => (structure.hits < this.towerList[i].room.memory.structureHitsMin && structure.hits < structure.hitsMax-5000 && (structure.structureType == STRUCTURE_WALL))// && structure.structureType != STRUCTURE_WALL)
                });
              }
              if(closestDamagedStructure) {
                if(closestDamagedStructure.structureType === STRUCTURE_WALL || closestDamagedStructure.structureType === STRUCTURE_RAMPART)
                  this.towerList[i].room.memory.structureHitsMin = closestDamagedStructure.hits;
                this.towerList[i].repair(closestDamagedStructure);
              }
              else if(Game.time % 10 === 0 && this.towerList[i].room.memory.structureHitsMin < 300000000){
                this.towerList[i].room.memory.structureHitsMin += this.minStructureHits;
              }
            }
          }
        }
      }
    }
}