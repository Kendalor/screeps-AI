

module.exports = class{
        constructor(){

        }
        static run(id){
            var creep_body = [TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,MOVE,MOVE,MOVE,MOVE,MOVE,HEAL,HEAL];
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED

            if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size && !Memory.operations[id].members.assembled){
                console.log('Spawning');
                //console.log(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'tank', operation: id, target: Memory.operations[id].flagName}));
                if(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'heal', operation: id, target: Memory.operations[id].flagName}) == OK){
                    var name=Game.spawns['Spawn1'].createCreep(creep_body,undefined,{role: 'heal', operation_id: id, target: Memory.operations[id].flagName});
                    Memory.operations[id].members[name]= 'heal';
                    console.log('Did spawn creep '+name);
                }

            }else if(Object.keys(Memory.operations[id].members).length == Memory.operations[id].size && !Memory.operations[id].assembled){
                var assembled =0;
                for(var cr in Memory.operations[id].members){
                    if(!Game.creeps[cr].spawning){
                        assembled=assembled+1;
                    }
                }
                if(assembled == Memory.operations[id].size){
                    Memory.operations[id].assembled = true;
                    console.log('Squad assembled');
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



                var lowestHP =Game.creeps[cr];
                if(Game.creeps[cr].hits < lowestHP.hits){
                    lowestHP =Game.creeps[cr];
                }


                if(Memory.operations[id].reached==false && Memory.operations[id].assembled==true){
                    if(Game.flags[Memory.operations[id].flagName].pos.inRangeTo(Game.creeps[cr],2)){
                        reached = reached+1;
                    }
                    if(reached == Object.keys(Memory.operations[id].members).length){
                        Memory.operations[id].reached=true;
                    }
                }else if(Memory.operations[id].assembled==true && Memory.operations[id].reached==true){
                    if(Game.flags[Memory.operations[id].flagName].pos.roomName == Game.creeps[cr].pos.roomName){
                        reached = reached+1;
                    }
                    if(reached != Object.keys(Memory.operations[id].members).length){
                        Memory.operations[id].reached=false;
                    }
                }
            }
            // RUN CREEP JOBS
            for(var cr in Memory.operations[id].members){
                if(!Game.creeps[cr].spawning && Game.creeps[cr]){
                    if(Memory.operations[id].assembled==false){
                        if(Game.creeps[cr].ticksToLive < 1400){
                            console.log('Running Refresh for '+cr);
                            this.refreshTimer(Game.creeps[cr]);
                        }else{
                            console.log('Running Idle for '+cr);
                            this.creepIdle(Game.creeps[cr]);
                        }
                    }else if(Memory.operations[id].assembled==true && Memory.operations[id].reached==false){
                        console.log('Running Travel for '+cr);
                        this.creepTravel(Game.creeps[cr],Game.flags[Memory.operations[id].flagName]);

                    }else if(Memory.operations[id].assembled==true && Memory.operations[id].reached==true){
                        console.log('Running Heal for '+cr);
                        this.creepHeal(Game.creeps[cr],lowestHP);
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
                Memory.operations[this.id].type='tank';
                Memory.operations[this.id].size=3;
                Memory.operations[this.id].assembled=false;
                Memory.operations[this.id].reached=false;

                Memory.operations[this.id].members= {};
                Memory.operations[this.id].rallyPoint=Game.flags[flag].pos.findClosestByPath(FIND_MY_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_TOWER}).id;


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
        static creepHeal(creep,lowestHP){

            switch (creep.pos.getRangeTo(lowestHP)){
                case 0:
                    console.log(creep.name+' Heals '+ creep.name);
                    creep.heal(creep);
                    break;
                case 1:
                    creep.heal(lowestHP);
                    console.log(creep.name+' Heals '+ lowestHP.name);
                    break;
                case 2:
                    creep.moveTo(lowestHP);
                    creep.heal(lowestHP);
                    console.log(creep.name+' Heals '+ lowestHP.name);
                    break;
                case 3:
                    creep.moveTo(lowestHP);
                    creep.rangedHeal(lowestHP);
                    console.log(creep.name+' Heals Ranged '+ lowestHP.name);
                    break;
                case 4:
                    creep.moveTo(lowestHP);
                    creep.rangedHeal(lowestHP);
                    console.log(creep.name+' Heals Ranged '+ lowestHP.name);
                    break;
                default:
                    creep.moveTo(lowestHP);
                    if(creep.hits < creep.hitsMax){
                        creep.heal(creep);
                        console.log(creep.name+' Heals '+ creep.name);
                    }
                    break;

            }

        }

        static refreshTimer(creep){
            var target = Game.spawns['Spawn1'];
            console.log(Game.spawns['Spawn1']);
            if( target.renewCreep(creep) == ERR_NOT_IN_RANGE && !target.spawning){
                creep.moveTo(target)
            }else if(target.renewCreep(creep) == ERR_FULL || target.spawning){
                this.creep.Idle(creep);
            }
        }






};
