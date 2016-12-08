var initMemory = {

    /** @param {Creep} creep **/
    run: function(roomName) {
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
            }
        }else{
            var sources = room.find(FIND_SOURCES);//Find all sources in the current room
            for(var i in sources){
                var source = sources[i];
                if(!source.memory){
                    source.memory = room.memory.sources[source.id] = {}; //Create a new empty memory object for this source
                    //Now you can do anything you want to do with this source
                    //for example you could add a worker counter:
                    source.memory.workers = 0;
                 }
            }
        }
        if(!room.memory.containers){
            room.memory.containers={};
            var containers = room.find(FIND_STRUCTURES,{
                filter: (structure) => structure.structureType == STRUCTURE_CONTAINER});
            for(var i in containers){
                var container =containers[i];
                container.memory= room.memory.containers[container.id]={};
            }
        }else{
            var containers = room.find(FIND_STRUCTURES,{
                filter: (structure) => structure.structureType == STRUCTURE_CONTAINER});
            for(var i in containers){
                var container =containers[i];
                if(!container.memory){
                    container.memory= room.memory.containers[container.id]={};
                }
            }
        if(room.memory.safe == undefined){
            room.memory.safe= true;
        }
        if(room.memory.buildinglvl == undefined){
            room.memory.buildinglvl =0;
        }




        }
	}
};

module.exports = initMemory;