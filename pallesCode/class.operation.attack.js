

module.exports = class{
        constructor(){

        }
        static run(id){
            //var creep_body = [MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK];
            var creep_body = [MOVE,MOVE,MOVE,MOVE,ATTACK,ATTACK,HEAL,HEAL];
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED

            if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size && !Memory.operations[id].members.assembled){
                //console.log('Spawning');
                //console.log(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'attacker', operation: id, target: Memory.operations[id].flagName}) == OK);
                if(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'attacker', operation: id, target: Memory.operations[id].flagName}) == OK){
                    var name=Game.spawns['Spawn1'].createCreep(creep_body,undefined,{role: 'attacker', operation_id: id, target: Memory.operations[id].flagName});
                    Memory.operations[id].members[name]= 'attacker';
                    console.log('Did spawn creep '+name);
                }

            }else if(Object.keys(Memory.operations[id].members).length == Memory.operations[id].size && !Memory.operations[id].assembled){
                Memory.operations[id].assembled = true;
                console.log('Squad assembled');
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


                if(Memory.operations[id].reached==false && Memory.operations[id].assembled==true){
                    if(Game.flags[Memory.operations[id].flagName].pos.inRangeTo(Game.creeps[cr],2)){
                        reached = reached+1;
                    }
                    if(reached == Memory.operations[id].size){
                        Memory.operations[id].reached=true;
                    }
                }else if(Memory.operations[id].assembled==true && Memory.operations[id].reached==true){
                    if(Game.flags[Memory.operations[id].flagName].pos.roomName == Game.creeps[cr].pos.roomName){
                        reached = reached+1;
                    }
                    if(reached != Memory.operations[id].size){
                        Memory.operations[id].reached=false;
                    }
                }
            }
            // RUN CREEP JOBS
            for(var cr in Memory.operations[id].members){
                if(!Game.creeps[cr].spawning && Game.creeps[cr]){
                    if(Memory.operations[id].assembled==false){
                        console.log('Running Refresh for'+cr);
                        if(Game.creeps[cr].ticksToLive < 1400){
                            this.refreshTimer(Game.creeps[cr]);
                        }else{
                            this.creepIdle(Game.creeps[cr]);
                        }
                    }else if(Memory.operations[id].assembled==true && Memory.operations[id].reached==false){
                        console.log('Running Travel for '+cr);
                        this.creepTravel(Game.creeps[cr],Game.flags[Memory.operations[id].flagName]);

                    }else if(Memory.operations[id].assembled==true && Memory.operations[id].reached==true){
                        console.log('Running Attack for '+cr);
                        this.creepAttack(Game.creeps[cr]);
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
                Memory.operations[this.id].type='attack';
                Memory.operations[this.id].size=1;
                Memory.operations[this.id].assembled=false;
                Memory.operations[this.id].reached=false;
                Memory.operations[this.id].refreshed=false;
                Memory.operations[this.id].members= {};
                Memory.operations[this.id].rallyPoint=Game.spawns['Spawn1'].pos.findClosestByPath(FIND_MY_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_TOWER}).id;


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
        static creepIdle(creep){
            var target = Game.getObjectById(Memory.operations[creep.memory.operation_id].rallyPoint);
            creep.moveTo(target);

        }
        // TRAVEL TO FLAG
        static creepTravel(creep,flag){
            creep.moveTo(flag);

        }
        // ATTACK CODE
        static creepAttack(creep){
            var closestHostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS,{filter: (creep) => (_.filter(creep.body,(body) => body.type == 'attack')).length =! 0,ignoreDestructibleStructures: true});
            var closestStr =creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES,{filter: (str) => (str.structureType == STRUCTURE_TOWER || str.structureType == STRUCTURE_SPAWN || str.structureType == STRUCTURE_EXTENSION), ignoreDestructibleStructures: true});
            var spawn = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_TOWER,ignoreDestructibleStructures: true});
            //console.log(closestHostile);
            if(closestHostile){
                //console.log(creep.name);
                //console.log('TEST2');
                if(creep.attack(closestHostile) == ERR_NOT_IN_RANGE){
                    creep.moveTo(closestHostile,{ignoreDestructibleStructures: true});
                    creep.heal(creep);
                    creep.say('attacking 1');
                }
            }else if (creep.hits < creep.hitsMax){
                creep.heal(creep);

            }else if(closestStr){

                if(creep.attack(closestStr) == ERR_NOT_IN_RANGE){
                    creep.moveTo(closestStr,{ignoreDestructibleStructures: true});
                    creep.heal(creep);
                    creep.say('attacking 2');
                }
            }else{
                //console.log('TEST3');
                creep.memory.reached=false;
                delete creep.memory.target;

            }

        }

        static refreshTimer(creep){
            var target = Game.spawns['Spawn1'];
            if(target.renewCreep(creep) == ERR_NOT_IN_RANGE){
                creep.moveTo(target)
            }else if(target.renewCreep(creep) == ERR_FULL){
                this.creep.Idle(creep);
            }
        }






};
