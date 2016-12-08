var roleHarvester = require('role.harvester');
var roleUpgrader = require('role.upgrader');
var roleBuilder = require('role.builder');


//Lets first add a shortcut prototype to the sources memory:
Source.prototype.memory = undefined;





module.exports.loop = function () {

    for(var roomName in Game.rooms){//Loop through all rooms your creeps/structures are in
        var room = Game.rooms[roomName];
        if(!room.memory.sources){//If this room has no sources memory yet
            room.memory.sources = {}; //Add it
            var sources = room.find(FIND_SOURCES);//Find all sources in the current room
            for(var i in sources){
                var source = sources[i];
                source.memory = room.memory.sources[source.id] = {}; //Create a new empty memory object for this source
                //Now you can do anything you want to do with this source
                //for example you could add a worker counter:
                source.memory.workers = 0;
                source.memory.occupied=0;
            }
        }
    }





    //var temp=Game.cpu.getUsed();
    //console.log('CPU Used: '+ temp);
}