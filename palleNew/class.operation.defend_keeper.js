var WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true};

module.exports = class{

        constructor(){

        }
        static run(id){
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
                this.buildCreeps(id);
                if(!Memory.operations[id].toDefend){
                    if(Game.ticks % 50 == 0){
                        console.log('DEFEND OPERATION '+id+' HAS NOTHING TO DO');
                    }
                }else{
                    let defendId=Memory.operations[id].toDefend;
                    var invaders=[];
                    if(Game.rooms[Memory.operations[defendId].roomName] && Game.ticks % 50 == 0){
                        var invaders=Game.rooms[Memory.operations[defendId].roomName].find(FIND_HOSTILE_CREEPS,{filter: cr => cr.owner == 'Invader'});
                        console.log('Searched Invaders');
                        console.log(invaders);
                    }

                    var keepers=[];
                    var lairs=[];
                    var creeps=[]
                    //search Sources in Operation for Keepers
                    for(var i in Memory.operations[defendId].sources){
                        let lair= Game.getObjectById(Memory.operations[defendId].sources[i].keeperLair);
                        let enemy=lair.pos.findInRange(FIND_HOSTILE_CREEPS,5);
                        let wounded=lair.pos.findInRange(FIND_MY_CREEPS,9,{filter: (cr) => cr.hits < cr.hitsMax});
                        if(invaders.length >0){
                            creep.memory.target=invaders[0].id;
                        }else if(enemy.length >0){
                            keepers.push(enemy[0]);
                        }else if(wounded.length>0){
                            creeps.push(wounded[0]);
                        }else{
                            lairs.push(lair);
                        }
                    }
                    for(var j in Memory.operations[id].members){
                        var creep=Game.creeps[j];
                            if(!creep.memory.target){
                                if(keepers.length >0){
                                    let target=keepers.pop();
                                    creep.memory.target=target.id;
                                }else if(creeps.length >0){
                                    creep.memory.target=creeps[0].id;
                                }else if(lairs.length >0){
                                    var temp=300;
                                    for(var t in lairs){
                                        if(lairs[t].ticksToSpawn < temp){
                                            temp=lairs[t].ticksToSpawn;
                                            var target=lairs[t];
                                        }
                                    }
                                    creep.memory.target=target.id;
                                }
                            }
                            if(creep.ticksToLive < 300 && Memory.operations[id].size== 1 && Object.keys(Memory.operations[id].members).length == 1){
                                Memory.operations[id].size=2;
                            }else if(Object.keys(Memory.operations[id].members).length >= 2){
                                Memory.operations[id].size=1;
                            }


                        this.creepHandle(creep,id);
                    }
                }





            }
        }
        /*
        TODO: REASSIGN HEALERS HEADLESS HEALERS TO FALL BACK AND ASSIGN THEM A NEW SQUAD
        */
        static creepHandle(creep,id){
            var target=Game.getObjectById(creep.memory.target);
            if(target){
                if(creep.pos.roomName != target.pos.roomName){
                    creep.moveTo(target);
                    if(creep.hits < creep.hitsMax){
                        creep.heal(creep);
                    }
                }else{
                    if(target.structureType == STRUCTURE_KEEPER_LAIR){
                        creep.moveTo(target);
                        if(creep.hits < creep.hitsMax){
                            creep.heal(creep);
                        }
                        creep.say('camp');
                        if(target.ticksToSpawn  == 1){
                            delete creep.memory.target;
                        }
                    }else{
                        if(!target.my){
                            creep.say('attack');
                            let err=creep.attack(target);
                            if(err == ERR_NOT_IN_RANGE){
                                if(creep.hits < creep.hitsMax){
                                    creep.heal(creep);
                                }
                                creep.moveTo(target);
                            }
                        }else if(target.my){
                            if(target.hits < target.hitsMax){
                                creep.say('aid');
                                let err=creep.heal(target);
                                if(err == ERR_NOT_IN_RANGE){
                                    creep.heal(creep);
                                    creep.moveTo(target);
                                }
                            }else{
                                delete creep.memory.target;
                            }
                        }
                    }
                }
            }else{
                    delete creep.memory.target;
                }

        }
        static checkForCreeps(id){
            var creepName;
            for(var sLeader in Memory.operations[id].squads){
                creepName=sLeader;
                for(var cr in Memory.operations[id].squads[sLeader]){
                    creepName=Memory.operations[id].squads[sLeader][cr]
                    if(!Game.creeps[creepName]){
                        console.log('Deleted Healer '+creepName +'from memory')
                        delete Memory.creeps[creepName];
                        Memory.operations[id].squads[sLeader].pop(creepName);
                    }

                }
                if(!Game.creeps[sLeader]) {
                        console.log('Deleted '+ sLeader +' from memory')
                        delete Memory.creeps[sLeader];


                        for(var cr in Memory.operations[id].squads[sLeader]){
                                console.log('Deleted '+cr +'from memory')
                                Memory.operations[id].squads[sLeader].pop(cr);
                                Game.creeps[creepName].suicide();
                                delete Memory.creeps[creepName];
                        }
                        delete Memory.operations[id].squads[sLeader];
                }
            }
        }


        static buildCreeps(id){
            if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size){
                var creep_body=Memory.operations[id].default_Abody;
                if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep(creep_body, undefined, {role: 'MineDefender', operation: id}) == OK){
                    var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep(creep_body,undefined,{role: 'MineDefender', operation_id: id});
                    Memory.operations[id].members[name]= {};
                    console.log('Did spawn Op Defender'+name);
                }

            }else{
                for(var i in Memory.operations[id].members){
                    if(!Game.creeps[i]){
                        delete Memory.creeps[i];
                        delete Memory.operations[id].members[i];
                    }

                }
            }
            // CHECK IF REACHED OR FLAG POSITION CHANGED
        }

        static findClosestSpawn(flagName){
            var min_length;
            var best_spawn;
            var length;
            for(var i in Game.spawns){
                console.log('length from '+Game.spawns[i].pos.roomName+' to '+Game.flags[flagName].pos.roomName);
                console.log( Object.keys(Game.map.findRoute(Game.spawns[i].pos.roomName,Game.flags[flagName].pos.roomName)).length < min_length  || min_length == undefined);
                length= Object.keys(Game.map.findRoute(Game.spawns[i].pos.roomName,Game.flags[flagName].pos.roomName)).length;
                if(length < min_length  || min_length == undefined){
                    min_length=length;
                    best_spawn=Game.spawns[i].id;
                }
            }
            return best_spawn;
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
                Memory.operations[this.id].flagPos= Game.flags[flag].pos;
                Memory.operations[this.id].permanent=false;
                Memory.operations[this.id].type='defendKeeper';
                Memory.operations[this.id].size=1; // NUMBER OF SQUADS ATTACKER = SQUAD LEADER
                //COST 12xMOVE = 600 + 12 ATTACK = 960 =1560
                //Memory.operations[this.id].default_Abody=Array(50).fill(TOUGH,0,28).fill(MOVE,28,36).fill(ATTACK,36,50);// COST 2300
                Memory.operations[this.id].default_Abody=Array(50).fill(MOVE,0,17).fill(ATTACK,17,40).fill(HEAL,40,50);// COST 2300
                Memory.operations[this.id].nearest_spawnId=this.findClosestSpawn(flag);
                Memory.operations[this.id].members={};



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





};
