var WHITELIST = {'Kendalor' : true,'Palle' : true};
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
        //var closestHostile = tower[i].pos.findClosestByRange(FIND_HOSTILE_CREEPS,(hostile) => WHITELIST[hostile.owner.username] == undefined && (_.filter(hostile.pos,(pos) => pos.x > 2 && pos.y > 2 && pos.x < 48 && pos.y < 48)) && (hostile.body.filter((body) => body.type == 'attack') || body.type == 'ranged_attack')).length > 0);
        var closestHostile = tower[i].pos.findClosestByRange(FIND_HOSTILE_CREEPS,{filter: (hostile) =>
          WHITELIST[hostile.owner.username] == undefined 
          && hostile.pos.x > 1 && hostile.pos.y > 1 && hostile.pos.x < 48 && hostile.pos.y < 48 
          && hostile.body.filter((body) => body.type == 'attack' || body.type == 'ranged_attack').length > 0
        })
		if (closestHostile == undefined) closestHostile = tower[i].pos.findClosestByRange(FIND_HOSTILE_CREEPS,{filter: (hostile) =>
          WHITELIST[hostile.owner.username] == undefined 
          && hostile.pos.x > 1 && hostile.pos.y > 1 && hostile.pos.x < 48 && hostile.pos.y < 48 
          && hostile.body.filter((body) => body.type == 'claim' || body.type == 'work').length > 0
        })
        if(closestHostile) {
            tower[i].attack(closestHostile);
        }else if(tower[i].room.energyAvailable == tower[i].room.energyCapacityAvailable){
          var closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
              filter: (structure) => (structure.hits < structure.hitsMax-1000 && structure.structureType != STRUCTURE_RAMPART && structure.structureType != STRUCTURE_WALL)
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