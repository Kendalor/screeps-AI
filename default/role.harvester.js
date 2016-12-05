var roleHarvester = {

    /** @param {Creep} creep **/
    run: function(creep) {

        if((creep.carry.energy == 0 && !creep.memory.harvesting )|| !creep.memory.targetId && creep.memory.harvesting) {
            creep.say('harvesting');
            creep.memory.harvesting=true;
            var sources = creep.room.find(FIND_SOURCES);
            //find nearest source

            var targetId=sources[0].id;
            for(var i in sources){
                //console.log('TAGET SETTING')
                //console.log(creep.room.memory.sources[targetId].workers)
                //console.log(creep.room.memory.sources[sources[i].id].workers)
                //console.log(creep.room.memory.sources[targetId].workers < creep.room.memory.sources[sources[i].id].workers)
                if(creep.room.memory.sources[targetId].workers > creep.room.memory.sources[sources[i].id].workers){
                    targetId=sources[i].id;
                }else{

                }
            }
            creep.memory.targetId=targetId;
            creep.room.memory.sources[targetId].workers = creep.room.memory.sources[targetId].workers+1;
	    }else if(creep.carry.energy == creep.carryCapacity && creep.memory.harvesting ) {
	        creep.memory.harvesting = false;
	        creep.room.memory.sources[creep.memory.targetId].workers = creep.room.memory.sources[creep.memory.targetId].workers-1;
	        delete creep.memory.targetId;
	        creep.say('spending');
	    }else{
            if(creep.memory.harvesting) {
                var target= Game.getObjectById(creep.memory.targetId);
                if(creep.harvest(target) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(target);

                }
            }else{
                var targets_energy = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_EXTENSION ||
                                structure.structureType == STRUCTURE_SPAWN /*||
                                structure.structureType == STRUCTURE_TOWER*/) && structure.energy < structure.energyCapacity;
                    }
                });
                if(targets_energy.length > 0) {
                    if(creep.transfer(targets_energy[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                        creep.moveTo(targets_energy[0]);

                    }
                }else{
                    var targets_constr_1 = creep.room.find(FIND_CONSTRUCTION_SITES);
                    if(targets_constr_1.length) {
                        var targets_constr = creep.pos.findClosestByPath(targets_constr_1);
                        if(creep.build(targets_constr) == ERR_NOT_IN_RANGE) {
                            creep.moveTo(targets_constr);

                        }
                    }else{
                        if(creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                            creep.moveTo(creep.room.controller);

                    }

                }

            }
        }
	    }
	}
};

module.exports = roleHarvester;