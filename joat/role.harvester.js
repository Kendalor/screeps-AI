var roleHarvester = {

    /** @param {Creep} creep **/
    run: function(creep) {

        if((creep.carry.energy == 0 && !creep.memory.harvesting )|| !creep.memory.targetId && creep.memory.harvesting) {
            creep.say('harvesting');
            creep.memory.harvesting=true;
            del creep.memory.targetId;
            del creep.memory.job;
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
            if(creep.memory.harvesting){
                var target= Game.getObjectById(creep.memory.targetId);
                if(creep.harvest(target) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(target);

                }
            }else if(!creep.memory.harvesting && !creep.memory.job && !creep.memory.targetId){
                var targets_energy = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_EXTENSION ||
                                structure.structureType == STRUCTURE_SPAWN /*||
                                structure.structureType == STRUCTURE_TOWER*/) && structure.energy < structure.energyCapacity;
                    }
                });
                if(targets_energy.length > 0) {
                    var target_energy=creep.pos.findClosestByPath(targets_energy);
                    creep.memory.targetId=target_energy.id;
                    creep.memory.job='carry';

                }else{
                    var targets_constr_1 = creep.room.find(FIND_CONSTRUCTION_SITES);
                    if(targets_constr_1.length){
                        var targets_constr = creep.pos.findClosestByPath(targets_constr_1);
                        creep.memory.targetId=target_constr.id;
                        creep.memory.job='building';
                    }else{
                        var targets_repair = creep.room.find(FIND_STRUCTURES, {
                            filter: (structure) => structure.hits < structure.hitsMax && structure.structureType != STRUCTURE_WALL
                        });
                        if(targets_repair.length){
                            var targets_repair_1 = creep.pos.findClosestByPath(targets_repair);
                            creep.memory.targetId=target_repair_1.id;
                            creep.memory.job='repair';
                        }else{
                            creep.memory.targetId=creep.room.comtroller.id;
                            creep.memory.job='upgrade';
                        }
                    }
                }
            }else if(creep.memory.job && !creep.memory.harvesting){
                if(creep.memory.job == 'carry'){
                    var target=Game.getObjectById(creep.memory.targetId;
                    //CHECK IS TARGET IS STILL VALID
                    if(target.energy < target.energyCapacity){
                        //TRANSFER ROUTINE
                        if(creep.transfer(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                            creep.moveTo(target);

                        }
                    }else{
                        del creep.memory.job;
                        del creep.memory.target;
                    }
                }
                else if(creep.memory.job == 'building'){
                    var target=Game.getObjectById(creep.memory.targetId;
                    //CHECK IS TARGET IS STILL VALID
                    if(!Game.getObjectById(creep.memory.targetId){
                        //BUILD ROUTINE
                        if(creep.build(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                            creep.moveTo(target);

                        }
                    }else{
                        del creep.memory.job;
                        del creep.memory.target;
                    }
                }
                else if(creep.memory.job == 'repair') {
                    var target=Game.getObjectById(creep.memory.targetId;
                    //CHECK IS TARGET IS STILL VALID
                    if(target.hits < target.hitsMax){
                        //BUILD ROUTINE
                        if(creep.repair(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                            creep.moveTo(target);

                        }
                    }else{
                        del creep.memory.job;
                        del creep.memory.target;
                    }
                }
                else if(creep memory.job == 'upgrading'){
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