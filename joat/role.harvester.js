var roleHarvester = {

    /** @param {Creep} creep **/
    run: function(creep) {
        /*console.log(creep.name);
        console.log('start harvesting mode');
        console.log((creep.carry.energy == 0 && !creep.memory.harvesting )|| !creep.memory.targetId && creep.memory.harvesting);
        console.log('stop harvesting mode?');
        console.log(creep.carry.energy == creep.carryCapacity && creep.memory.harvesting);*/


        //START HARVESTING MODE ?
        if((creep.carry.energy == 0 && !creep.memory.harvesting )|| !creep.memory.targetId && creep.memory.harvesting) {
            creep.say('harvesting');
            creep.memory.harvesting=true;
            if(creep.memory.targetId){
                delete creep.memory.targetId;
            }
            if(creep.memory.job){
                delete creep.memory.job;
            }

            creep.memory.targetId=creep.room.storage.id;

	    }
        //STOP HARVESTING MODE?
	    else if(creep.carry.energy == creep.carryCapacity && creep.memory.harvesting ) {
	        creep.memory.harvesting = false;

	        delete creep.memory.targetId;
	        creep.say('spending');
	    }else{
            /*console.log('Harvesting?');
            console.log(creep.memory.harvesting);
            console.log('Looking for a Job ?');
            console.log(!creep.memory.harvesting && !creep.memory.job && !creep.memory.targetId);
            console.log('Doing a Job?');
            console.log(creep.memory.job && !creep.memory.harvesting);*/
            //HARVESTING
            if(creep.memory.harvesting){
                var target= Game.getObjectById(creep.memory.targetId);

                if(creep.withdraw(target,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(target);

                }
            }
            //LOOKING FOR A JOB?
            else if(!creep.memory.harvesting && !creep.memory.job){
                var targets_energy = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_EXTENSION ||
                                structure.structureType == STRUCTURE_SPAWN ||
                                (structure.structureType == STRUCTURE_TOWER && structure.energy < structure.energyCapacity*0.5)) && structure.energy < structure.energyCapacity;
                    }
                });
                if(targets_energy.length > 0) {
                    var target_energy=creep.pos.findClosestByPath(targets_energy);
                    creep.memory.targetId=target_energy.id;
                    creep.memory.job='carry';
                    creep.say('Im Hauling');

                }else{
                    var targets_constr_1 = creep.room.find(FIND_CONSTRUCTION_SITES);
                    if(targets_constr_1.length){
                        var targets_constr = creep.pos.findClosestByPath(targets_constr_1);
                        creep.memory.targetId=targets_constr.id;
                        creep.memory.job='building';
                        creep.say('Im Building');
                    }else{
                        var targets_repair = creep.room.find(FIND_STRUCTURES, {
                            filter: (structure) => (structure.hits < structure.hitsMax-1500 && structure.structureType != STRUCTURE_WALL && structure.structureType != STRUCTURE_RAMPART) ||
                            (structure.structureType == STRUCTURE_WALL && structure.hits < 10000*Game.spawns['Spawn1'].room.controller.level) ||
                            (structure.structureType == STRUCTURE_RAMPART && structure.hits < 10000*Game.spawns['Spawn1'].room.controller.level)
                        });
                        if(targets_repair.length){
                            var targets_repair_1 = creep.pos.findClosestByPath(targets_repair);
                            creep.memory.targetId=targets_repair_1.id;
                            creep.memory.job='repair';
                            creep.say('Im Reparing');
                        }else{
                            creep.memory.targetId=creep.room.controller.id;
                            creep.memory.job='upgrade';
                            creep.say('Im upgrading');
                        }
                    }
                }
            // DOING A JOB ?
            }
            if(creep.memory.job && !creep.memory.harvesting){
                /*console.log('Carry?');
                console.log(creep.memory.job == 'carry');
                console.log('Building');
                console.log(creep.memory.job == 'building');
                console.log('Repair?');
                console.log(creep.memory.job == 'repair');
                console.log('upgrade?');
                console.log(creep.memory.job == 'upgrade');*/
                if(creep.memory.job == 'carry'){
                    var target=Game.getObjectById(creep.memory.targetId);
                    //CHECK IS TARGET IS STILL VALID
                    if(target.energy < target.energyCapacity){
                        //TRANSFER ROUTINE
                        if(creep.transfer(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                            creep.moveTo(target);

                        }
                    }else{
                        delete creep.memory.job;
                        delete creep.memory.target;
                    }
                }
                else if(creep.memory.job == 'building'){
                    var target=Game.getObjectById(creep.memory.targetId);
                    //CHECK IS TARGET IS STILL VALID
                    if(Game.getObjectById(creep.memory.targetId)){
                        //BUILD ROUTINE
                        if(creep.build(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                            creep.moveTo(target);

                        }
                    }else{
                        delete creep.memory.job;
                        delete creep.memory.target;
                    }
                }
                else if(creep.memory.job == 'repair') {
                    var target=Game.getObjectById(creep.memory.targetId);
                    //CHECK IS TARGET IS STILL VALID
                    if((target.structureType != target.hits < target.hitsMax-1500 && target.structureType != STRUCTURE_WALL && target.structureType != STRUCTURE_RAMPART) ||
                            (target.structureType == STRUCTURE_WALL && target.hits < 10000*Game.spawns['Spawn1'].room.controller.level) ||
                            (target.structureType == STRUCTURE_RAMPART && target.hits < 10000*Game.spawns['Spawn1'].room.controller.level)){
                        //BUILD ROUTINE
                        if(creep.repair(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                            creep.moveTo(target);

                        }
                    }else{
                        delete creep.memory.job;
                        delete creep.memory.target;
                    }
                }
                else if(creep.memory.job == 'upgrade'){
                    var target=Game.getObjectById(creep.memory.targetId);
                    //console.log('controller not in range?');
                    //console.log(creep.upgradeController(target) == ERR_NOT_IN_RANGE);
                    if(creep.upgradeController(target) == ERR_NOT_IN_RANGE) {
                        creep.moveTo(target);

                    }


                }

            }
        }

	}
};

module.exports = roleHarvester;