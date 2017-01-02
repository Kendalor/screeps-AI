var autoCreep         = require('auto.creep');
var autoMemory        = require('auto.memory');
var autoSpawn         = require('auto.spawn');
var invasionCounter   = require('invasion.counter');

//Kendalor Code
var operationsHandler = require('operations.handler');
var flagHandler       = require('flag.handler');
//

Source.prototype.memory = undefined;



module.exports.loop = function () {
  
  autoMemory.clearDeadCreeps();
  autoMemory.clearFlags();
  
  //Kendalor Code
  flagHandler.run();
  operationsHandler.run();
  //  
  
  for(var name in Game.rooms) {
  
    
    var room = Game.rooms[name];
    //autoMemory.fixSourceSlots(room);
	 
    invasionCounter.run(room);
    
    //if(Game.time % 10 == 0){
	var spawnList = (room.find(FIND_MY_STRUCTURES,{filter: (structure) => structure.structureType == STRUCTURE_SPAWN}));
	autoSpawn.run(spawnList);
    //}
    
    var creepList = (room.find(FIND_MY_CREEPS,{filter: (creep) => creep.room.name == name}));
    autoCreep.run(creepList);
	
  } 
}