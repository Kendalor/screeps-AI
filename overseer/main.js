//var roleHarvester = require('role.harvester');
var roleMiner = require('role.miner');
var phase1 = require('room.phase1');
var blueprints = require('blueprints');
var initMemory = require('initMemory');
var creepHandler = require('creep');
var actMemory = require('actMemory');

//Lets first add a shortcut prototype to the sources memory:
Source.prototype.memory = undefined;





module.exports.loop = function () {
    // ITERATE OVER ALL ROOMS
    for(var roomName in Game.rooms){//Loop through all rooms your creeps/structures are in
        initMemory.run(roomName); // INIT ROOM MEMORY
        if(Game.rooms[roomName].memory.safe){
            phase1.run(roomName);
        }
    }
    //ITERATE OVER ALL CREEPS
    for(var i in Game.creeps){
        creepHandler.run(Game.creeps[i]);
    }
    actMemory.run();
    //console.log(Object.keys(Game.constructionSites).length);



    //var temp=Game.cpu.getUsed();
    //console.log('CPU Used: '+ temp);
}