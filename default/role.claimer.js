var roleAttacker = {

    /** @param {Creep} creep **/
    run: function(creep) {

    if(!creep.memory.target && !creep.memory.reached){
        for(var i in Game.flags){
            if(Game.flags [i].color == COLOR_GREEN){
            var target = Game.flags[i];
            }
        }
        creep.memory.target=target;


    }else if(creep.memory.target && !creep.memory.reached){

     var target=Game.flags[creep.memory.target];
                //console.log(target);
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


                //if(creep.room.name = target.room.name){}
                if(creep.pos.inRangeTo(target,2)){
                    creep.memory.reached=true;
                }




    }else{
        var target = creep.rom.find(FIND_STRUCTURES,{filter: (structure) => structure.structureType == STRUCTURE_CONTROLLER})
        if(){

        }
    }
    }
};

module.exports = roleAttacker;