var autoCreep         = require('auto.creep');
var autoMemory        = require('auto.memory');
var autoSpawn         = require('auto.spawn');
var autoTower         = require('auto.tower');
var invasionCounter   = require('invasion.counter');

//Kendalor Code
var operationsHandler = require('operations.handler');
var flagHandler       = require('flag.handler');
//

Source.prototype.memory = undefined;


module.exports.loop = function () {
  
  autoMemory.clearDeadCreeps();
  autoMemory.clearFlags();
  
  for(var name in Game.rooms) {
  
  
    var room = Game.rooms[name];
    
    if(Game.time % 50 == 0){
      autoMemory.checkRoomMemory(room);
    }
    
    invasionCounter.run(room);
    invasionCounter.placeWalls(room);
    
    if(Game.time % 25 == 0){
      var spawnList = (room.find(FIND_MY_STRUCTURES,{filter: (structure) => structure.structureType == STRUCTURE_SPAWN}));
      autoSpawn.run(spawnList);
    }
    
    var towerList = (room.find(FIND_MY_STRUCTURES,{filter: (structure) => structure.structureType == STRUCTURE_TOWER}));
    autoTower.run(towerList);
    
    var creepList = (room.find(FIND_MY_CREEPS,{filter: (creep) => creep.room.name == name}));
    autoCreep.run(creepList);
  }
  
  //Kendalor Code
  operationsHandler.run();
  if(Game.time % 10 == 0)
    flagHandler.run();
  //
}