var roleAttacker = {

    /** @param {Creep} creep **/
    run: function(creep) {


        if(!creep.spawning){
        if(creep.memory.reached){
            var closestHostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);

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
                        for(var i=0;i<255;i++){
                            for(var j=0;j<255;j++){
                                costMatrix.set(i,j,255);
                            }
                        }
		            }
	            }

                });
                console.log(creep.moveTo(target,{ignoreDestructibleStructures: true}));
                //if(creep.room.name = target.room.name){}
                if(creep.pos.inRangeTo(target,2)){
                    creep.memory.reached=true;
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


    }
};

module.exports = roleAttacker;