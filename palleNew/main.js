var debug = require('debug');
require('prototypes')();

var WHITELIST = {'Kendalor' : true};//,'Invader':true};

module.exports.loop = function () {
  /*
  if(Game.time % 2 == 0 && false){
    debug.dumpTable(true,Game.rooms['sim']);
    //debug.testDump(Game.rooms);
  }
  */
  
  for(var name in Game.rooms) {
    var room = Game.rooms[name];
    //console.log(JSON.stringify(WHITELIST))
    var closestHostile = room.find(FIND_HOSTILE_CREEPS,{filter: (hostile) => WHITELIST[hostile.owner.username] == undefined}) //throw "filter does not work";
    console.log(closestHostile[0])
      
    /*
    var spawnStructure = room.find(FIND_STRUCTURES, {filter: (structure) => (structure.structureType == STRUCTURE_EXTENSION ||
            structure.structureType == STRUCTURE_SPAWN)});
    spawnStructure = room.find(FIND_SOURCES);
    spawnStructure = room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_ROAD});
    console.log()
    console.log(spawnStructure[0]);
    console.log(Game.getObjectById(spawnStructure[0].id));
    console.log(spawnStructure[0].structureType);
    */
    var spawnList = (room.find(FIND_MY_STRUCTURES,{filter: (structure) => structure.structureType == STRUCTURE_SPAWN}));
    for(var id in spawnList) {
      var spawn = spawnList[id];
      spawn.createCustomCreep(1,2);
    }
  }  
}