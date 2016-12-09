var actMemory = {

    /** @param {Creep} creep **/
    run: function() {
    // ACCOUNT MAX NUMBER OF CREEPS
    //BUILDERS
    Memory.max_creeps.builders = parseInt(Object.keys(Game.constructionSites).length/5);
    var sources_available=0;
    var containers_available=0;
    for(var room in Game.rooms){
        sources_available=sources_available+Object.keys(Game.rooms[room].memory.sources).length;
        containers_available=containers_available+Object.keys(Game.rooms[room].memory.containers).length;
    }
    //MINERS,HAUKLERS,HARVESTERS,UPGRADERS
    Memory.max_creeps.miners=containers_available;
    Memory.max_creeps.haulers=containers_available;
    Memory.max_creeps.harvesters=(sources_available-containers_available)*5;


    //DELETE DEAD CREEPS
    for(var name in Memory.creeps) {
        if(!Game.creeps[name]) {
            delete Memory.creeps[name];
            console.log('Clearing non-existing creep memory:', name);
        }
    }

    }

};

module.exports = actMemory;