
var autoCreep         = require('auto.creep');
var autoMemory        = require('auto.memory');
var autoSpawn         = require('auto.spawn');
var invasionCounter   = require('invasion.counter');

//Kendalor Code
var operationsHandler = require('operations.handler');


Source.prototype.memory = undefined;
var cpu=0;
var cpu_old=0;


module.exports.loop = function () {
    cpu=Game.cpu.getUsed();
  autoMemory.clearDeadCreeps();
  autoMemory.clearFlags();
    cpu_old=cpu-Game.cpu.getUsed();
  console.log('AutoMemory Code: '+cpu_old);

  //Kendalor Code
  cpu=Game.cpu.getUsed();
  operationsHandler.init();
  operationsHandler.run();
  cpu_old=cpu-Game.cpu.getUsed();
  console.log('Kendalor Code: '+cpu_old);
  //  

  cpu=Game.cpu.getUsed();
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
  cpu_old=cpu-Game.cpu.getUsed();
  console.log('BaseCode uses: '+cpu_old);
}