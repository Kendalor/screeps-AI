module.exports = class{
        constructor(){
        }
        static run(id){
            // DELETE NONEXISTING CREEPS FROM OPERATION
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
				
				var userName;
				for (var i in Game.spawns){userName = Game.spawns[i].owner.username;break;}
				var secondSpawnCondition = true;
				/*
				if (Game.flags[Memory.operations[id].flagName].room){
					var reservation = Game.flags[Memory.operations[id].flagName].room.controller.reservation
					secondSpawnCondition = reservation.ticksToEnd < (3500+Memory.operations[id].ticksToController) && (reservation.username == undefined || reservation.username == userName) // CHECK IF CONTROLLER RESERVATION IS HIGH ENOUGH
				}
				*/
				//if(!Memory.operations[id].creep){ //DOES THIS OPERATION ALREADY HAVE A CREEP?
                if (!Memory.operations[id].creep && secondSpawnCondition){ //DOES THIS OPERATION ALREADY HAVE A CREEP?				
                    var spawn = Game.getObjectById(this.findClosestSpawn(Memory.operations[id].flagName));
					var body = [MOVE,CLAIM]
					if (spawn.room.energyCapacityAvailable >= 1300)
						body = [MOVE,CLAIM,MOVE,CLAIM]
                    if(spawn.canSpawnCreep(body,undefined,{role: 'reserve', operation_id: id}) == OK){// NO SPAWN IT IF POSSIBLE !
                        //var name=spawn.spawnCreep(body,undefined,{role: 'reserve', operation_id: id});
                        var name=spawn.spawnCreep(body,undefined,{role: 'reserve', operation_id: id});
                        var creep=Game.creeps[name];
                        Memory.operations[id].creep=name;
                    }
                }else if(!Game.creeps[Memory.operations[id].creep]){
                    console.log('Deleted '+Memory.operations[id].creep +'from memory')
                    delete Memory.creeps[Memory.operations[id].creep];
                    delete Memory.operations[id].creep;
                }else if(!Game.creeps[Memory.operations[id].creep].spawning){ //IF CREEP FINISHED SPAWNING
                    var creep= Game.creeps[Memory.operations[id].creep];
                    var roomName = Memory.operations[id].roomName;
                    if(creep.room.name != roomName){
                        creep.travelTo(Game.flags[Memory.operations[id].flagName]);
                        creep.say('Traveling to Room');
                    }else{
                        let controller = Game.rooms[Memory.operations[id].roomName].controller;
                        if(creep.inRangeTo(controller)){
                            creep.reserveController(controller);
                            creep.say('Reserve');
                            if(!Memory.operations[id].ticksToController || Memory.operations[id].ticksToController > 500-creep.ticksToLive){
                                Memory.operations[id].ticksToController=500-creep.ticksToLive;
                                //Memory.operations[id].spawnCreepAtTime=Game.time
                            }
                        }else{
                            creep.travelTo(controller);
                        }
                    }
                }
            }
        }

        static init(roomName,flag){
            if(!Game.flags[flag].memory.operation_id){
                if(!Memory.operations){
                        Memory.operations={};
                }
                this.id=parseInt(Math.random()*10000000);
                console.log(this.isIdFree(this.id));
                while(!this.isIdFree(this.id)){
                    this.id=parseInt(Math.random()*10000000);
                }

                this.roomName=roomName;
                console.log(flag);
                console.log(this.id);
                console.log(this.roomName);
                this.flagName=flag;

                Game.flags[flag].memory.operation_id=this.id;

                if(!Memory.operations[this.id]){
                    Memory.operations[this.id]={}
                }
                //DEFINE ALL OP VARIABLES HERE
                Memory.operations[this.id].roomName=roomName;
                Memory.operations[this.id].flagName=flag;
                Memory.operations[this.id].permanent=false;
                Memory.operations[this.id].type='reserve';
                Memory.operations[this.id].spawnCreepAtTime= 0;
                console.log(JSON.stringify(Memory.operations[this.id]));
            }
        }
        // CHECK IF ID IS AVAILABLE
        static isIdFree(id){
            var out=true;
            for(var i in Memory.operations){
                if(Memory.operations[id]){
                    out= false;
                }
            }
            return out;
        }
        static checkForDelete(id){
            var flagname =  Memory.operations[id].flagName;
            if(!Game.flags[flagname] && !Memory.operations[id].permanent){
                delete Memory.flags[flagname];
                delete Memory.operations[id];

                return true;
            }else {
                return false;
            }
        }
        static findClosestSpawn(flagName){
            var min_length;
            var best_spawn;
            var length;
            for(var i in Game.spawns){
                //console.log('length from '+Game.spawns[i].pos.roomName+' to '+Game.flags[flagName].pos.roomName);
                //console.log( Object.keys(Game.map.findRoute(Game.spawns[i].pos.roomName,Game.flags[flagName].pos.roomName)).length < min_length  || min_length == undefined);
                length= Object.keys(Game.map.findRoute(Game.spawns[i].pos.roomName,Game.flags[flagName].pos.roomName)).length;
                if(length < min_length  || min_length == undefined){
                    min_length=length;
                    best_spawn=Game.spawns[i].id;

                }


            }
            return best_spawn;
          
            /*
            var flag = Game.flags[flagName]
            return flag.pos.findClosestByPath(FIND_MY_SPAWNS).id;
            */
        }
};
