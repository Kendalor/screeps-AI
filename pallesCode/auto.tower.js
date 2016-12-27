var WHITELIST = {'Kendalor' : true,'Invader':true};
var minStructureHits = 1000

module.exports = {
  /** @param {towerList} towerList **/
  run: function(towerList) {
    var tower = towerList;
    for(var i in tower){
      if(tower[i] != null) {
        if (!tower[i].room.memory.structureHitsMin || tower[i].room.memory.structureHitsMin < minStructureHits){
          tower[i].room.memory.structureHitsMin = minStructureHits;
        }
        var minHits = tower[i].room.memory.structureHitsMin;
        var closestHostile = tower[i].pos.findClosestByRange(FIND_HOSTILE_CREEPS,(hostile) => WHITELIST[hostile.owner.username] == undefined && (_.filter(hostile.body,(body) => body.type == 'attack' || body.type == 'ranged_attack')).length > 0);
        if(closestHostile) {
            tower[i].attack(closestHostile);
        }else if(tower[i].room.energyAvailable == tower[i].room.energyCapacityAvailable){
          var closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
              filter: (structure) => (structure.hits < structure.hitsMax/2 && structure.structureType != STRUCTURE_RAMPART && structure.structureType != STRUCTURE_WALL)
          });
          if(!closestDamagedStructure){
            closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
              filter: (structure) => (structure.hits < minStructureHits && (structure.structureType == STRUCTURE_RAMPART))// && structure.structureType != STRUCTURE_WALL)
            });
            minHits = minStructureHits;
          }
          if(!closestDamagedStructure){
            closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
              filter: (structure) => (structure.hits < minStructureHits && (structure.structureType == STRUCTURE_WALL))// && structure.structureType != STRUCTURE_WALL)
            });
            minHits = minStructureHits;
          }
          if(!closestDamagedStructure){
            closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
              filter: (structure) => (structure.hits < tower[i].room.memory.structureHitsMin && structure.hits < structure.hitsMax-5000 && (structure.structureType == STRUCTURE_RAMPART))// && structure.structureType != STRUCTURE_WALL)
            });
          }
          if(!closestDamagedStructure){
            closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
              filter: (structure) => (structure.hits < tower[i].room.memory.structureHitsMin && structure.hits < structure.hitsMax-5000 && (structure.structureType == STRUCTURE_WALL))// && structure.structureType != STRUCTURE_WALL)
            });
          }
          if(closestDamagedStructure) {
            if(closestDamagedStructure.structureType == STRUCTURE_WALL || closestDamagedStructure.structureType == STRUCTURE_RAMPART)
              tower[i].room.memory.structureHitsMin = closestDamagedStructure.hits;
            tower[i].repair(closestDamagedStructure);
          }
          else if(Game.time % 10 == 0 && tower[i].room.memory.structureHitsMin < 300000000){
            tower[i].room.memory.structureHitsMin += minStructureHits;
          }
        }
      }
    }
  }
};