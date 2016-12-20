

module.exports = class{
        constructor(){

        }
        static run(id){
            var creep_body = [CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE];
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED

            if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size){
                //console.log('Spawning');
                //console.log(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'attacker', operation: id, target: Memory.operations[id].flagName}) == OK);
                if(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'thief', operation: id}) == OK){
                    var name=Game.spawns['Spawn1'].createCreep(creep_body,undefined,{role: 'thief', operation_id: id});
                    Memory.operations[id].members[name]= 'thief';
                    console.log('Did spawn creep '+name);
                }
            }
            // CHECK IF REACHED OR FLAG POSITION CHANGED
            var reached=0;
            for(var cr in Memory.operations[id].members){
                // DELETE NONEXISTING CREEPS FROM OPERATION
                if(!Game.creeps[cr]) {
                    console.log('Deleted '+cr +'from memory')
                    delete Memory.creeps[cr];
                    delete Memory.operations[id].members[cr];
                }
            }
            // RUN CREEP JOBS
            for(var cr in Memory.operations[id].members){
                if(!Game.creeps[cr].spawning && Game.creeps[cr]){

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
                Memory.operations[this.id].type='steal';
                Memory.operations[this.id].size=10;
                Memory.operations[this.id].members= {};
                Memory.operations[this.id].home=Game.spawns['Spawn1'].pos.storage.id;
                Memory.operations[this.id].target=Game.flags[flag].pos.roomName;


                //console.log(JSON.stringify(Memory.operations[this.id]));
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
        // CHECK IF FLAG IS STILL EXISITING, IF NOT => DELETE OPERATION IF NOT PERMANENT
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
        // IDLE MOVESET
        static creepSteal(creep){
                if(creep.carry.energy < creep.carryCapacity){
                    var target_r=Game.flags[Memory.operations[creep.memory.operation_id].flagName].pos.findClosestByPath(FIND_RESSOURCE_ENERGY);
                    var target_c=Game.flags[Memory.operations[creep.memory.operation_id].flagName].pos.findClosestByPath(STRUCTURE_CONTAINER);
                    if(target){
                        if(creep.pickup(target,RESSOURCE_ENERGY) == ERR_NOT_IN_RANGE){
                            creep.moveTo(target);
                            creep.say('picking up ressource');
                        }
                    }else if(target_c){
                        if(creep.withdraw(target,RESSOURCE_ENERGY) == ERR_NOT_IN_RANGE){
                            creep.moveTo(target);
                            creep.say('picking up container');
                        }
                    }else{
                        creep.moveTo(Game.flags[Memory.operations[creep.memory.operation_id].flagName]);
                        creep.say('moving to flagRoom');
                    }
                }else{
                    var target=Game.rooms[Game.spawns['Spawn1'].pos.roomName].storage;
                    if(creep.transfer(target,RESSOURCE_ENERGY) == ERR_NOT_IN_RANGE){
                        creep.moveTo(target);
                        creep.say('Moving to Storage');
                }

                }


        }

};
