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
  
  
  for(var name in Game.rooms) {
  
    
    var room = Game.rooms[name];
    //autoMemory.fixSourceSlots(room);
	
    
    if(Game.time % 50 == 0){
      autoMemory.checkRoomMemory(room);
    }
    
    invasionCounter.run(room);
    
    if(Game.time % 10 == 0){
      var spawnList = (room.find(FIND_MY_STRUCTURES,{filter: (structure) => structure.structureType == STRUCTURE_SPAWN}));
      autoSpawn.run(spawnList);
    }
    
    var creepList = (room.find(FIND_MY_CREEPS,{filter: (creep) => creep.room.name == name}));
    autoCreep.run(creepList);
	
  }
/* BUGFIX
var spawn =Game.spawns['Spawn1'];
 var minerAmount = spawn.room.memory.activeCreepRoles.miner = _.filter(Game.creeps, (creep) => creep.room.name == spawn.room.name && creep.memory.role==creepRole[0].name).length;
 var sources = spawn.room.memory.sources;
    for(id in sources){
      var found = true;
        console.log(_.filter(Game.creeps, (creep) => creep.id == spawn.room.memory.sources[id].minerId).length);
        if(_.filter(Game.creeps, (creep) => creep.id == spawn.room.memory.sources[id].minerId).length == 0 && found){
            spawn.createCreep(this.minerPreset(spawn), undefined, {role: creepRole[0].name, source: id, spawn: true,job: 'idle', targetId: null, containerId: null});
            found = false;
          }
        }
*/




  //Kendalor Code
  operationsHandler.run();
  if(Game.time % 10 == 0)
    flagHandler.run();
  //
}