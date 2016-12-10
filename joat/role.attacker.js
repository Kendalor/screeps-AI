var roleAttacker = {

    /** @param {Creep} creep **/
    run: function(creep) {



        if(Memory.squads[creep.memory.squad].reached){
            var closestHostile = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES,{filter: (structure) => structure.structureType == STRUCTURE_SPAWN});
            if(closestHostile) {
                if(creep.attack(closestHostile) == ERR_NOT_IN_RANGE){
                    creep.moveTo(closestHostile);
                }
                }
            creep.say('attacking');
        }else{
            if(Memory.squads[creep.memory.squad].assembled){
                var target=Game.flags[creep.memory.target];
                console.log(target);
                creep.moveTo(target,{costCallback: function(roomName, costMatrix) {
	                if(roomName == 'E79N43') {
		            return false;
		            }
	            }

                });
                console.log(creep.moveTo(target,{ignoreDestructibleStructures: true}));
                //if(creep.room.name = target.room.name){}
                if(creep.pos.inRangeTo(target,2)){
                    Memory.squads[creep.memory.squad].reached=true;
                }

            }else{
                creep.say('waiting for assembling')
                if(!Memory.squads[creep.memory.squad].members[creep.id]){
                    Memory.squads[creep.memory.squad].members[creep.id]=creep.id;
                    console.log('added');
                }

        }

        }


    }
};

module.exports = roleAttacker;