var creep = {

    /** @param {Creep} creep **/
    run: function(creep) {
        //Travel to Location
        if(!creep.memory.target){
            for(source in creep.room.memory.sources){
                if(!creep.room.memory.sources[source].occupied){
                    creep.room.memory.sources[source].occupied=creep.id;
                    creep.memory.target=source.id;
                    creep.say()
                }
            }

        }else{}
    }




};

module.exports = creep;