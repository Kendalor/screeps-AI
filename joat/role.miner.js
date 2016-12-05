var roleMiner = {

    /** @param {Creep} creep **/
    run: function(creep) {
        //Travel to Location
        if(creep.memory.atLocation=false){
            for(source in creep.room.memory.sources){
                if(creep.room.memory.sources[source].workers == 0){
                    creep.memory.target=creep.room.memory.sources[source].id;
                }
                creep.room.memory.sources[source].workers = creep.room.memory.sources[source].workers +1;
            }

        }
        }




    }