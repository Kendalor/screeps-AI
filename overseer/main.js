//var roleHarvester = require('role.harvester');
var roleMiner = require('role.miner');
var phase1 = require('room.phase1');
var blueprints = require('blueprints');
var initMemory = require('initMemory');


//Lets first add a shortcut prototype to the sources memory:
Source.prototype.memory = undefined;





module.exports.loop = function () {

    for(var roomName in Game.rooms){//Loop through all rooms your creeps/structures are in
        initMemory.run(roomName);
    }





    //var temp=Game.cpu.getUsed();
    //console.log('CPU Used: '+ temp);
}