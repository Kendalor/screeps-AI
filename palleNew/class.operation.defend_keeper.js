var WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true};

module.exports = class{

        constructor(){

        }
        static run(id){
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
                this.buildCreeps(id);
                if(!Memory.operations[id].spawnList){
                    Memory.operations[id].spawnList=this.findClosestSpawn(Game.flags[Memory.operations[id].flagName].pos.roomName,1);
                }
                this.invasionHandler(id);
                if(!Memory.operations[id].toDefend){
                    if(Game.ticks % 50){
                        console.log('DEFEND OPERATION '+id+' HAS NOTHING TO DO');
                    }
                }else{
                    let defendId=Memory.operations[id].toDefend;
                    var keepers=[];
                    var lairs=[];
                    var creeps=[]
                    //search Sources in Operation for Keepers


                    for(var i in Memory.operations[defendId].sources){
                        let lair= Game.getObjectById(Memory.operations[defendId].sources[i].keeperLair);
                        let enemy=lair.pos.findInRange(FIND_HOSTILE_CREEPS,6,{filter: cr => cr.owner.username == 'Source Keeper'});
                        let wounded=lair.pos.findInRange(FIND_MY_CREEPS,6,{filter: (cr) => cr.hits < cr.hitsMax});
                        if(enemy.length >0){
                            keepers.push(enemy[0]);
                        }else if(wounded.length>0){
                            creeps.push(wounded[0]);
                        }else{
                            lairs.push(lair);
                        }
                    }
                    for(var j in Memory.operations[id].members){
                        var creep=Game.creeps[j];
                        if(creep){
                            if(!creep.memory.target){
                                if(keepers.length >0){
                                    let target=keepers[0];
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
                            if(creep.ticksToLive < 300 && Memory.operations[id].size== 1 && Object.keys(Memory.operations[id].members).length == parseInt(1+Object.keys(Memory.operations[defendId].sources).length/2)){
                                Memory.operations[id].size=parseInt(2+Object.keys(Memory.operations[defendId].sources).length/2);
                            }else if(Object.keys(Memory.operations[id].members).length >= parseInt(2+Object.keys(Memory.operations[defendId].sources).length/2)){
                                Memory.operations[id].size=parseInt(1+Object.keys(Memory.operations[defendId].sources).length/2);
                            }else if(Object.keys(Memory.operations[id].members).length < parseInt(2+Object.keys(Memory.operations[defendId].sources).length/2)){
                                Memory.operations[id].size=parseInt(1+Object.keys(Memory.operations[defendId].sources).length/2);
                            }
                            this.creepHandle(creep,id);
                        }
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

        static invasionHandler(id){
            let defendId=Memory.operations[id].toDefend;

            if(Game.rooms[Memory.operations[defendId].roomName]){
                var room=Game.rooms[Memory.operations[defendId].roomName];
                var enemies=room.find(FIND_HOSTILE_CREEPS,{filter: cr => cr.owner.username == 'Invader'});
                if(enemies.length >0){
                    let spawnTime=Game.time-1500+enemies[0].ticksToLive;
                    if(Memory.operations[id].invasionHandler.invasions.length ==0){
                        Memory.operations[id].invasionHandler.invasions.push(spawnTime);
                    }else{
                        let length=Memory.operations[id].invasionHandler.invasions.length;
                        if(Memory.operations[id].invasionHandler.invasions[length-1] != spawnTime){
                            Memory.operations[id].invasionHandler.invasions.push(spawnTime);
                        }
                    }

                    Memory.operations[id].invasionHandler.invasions.members=this.creepBuilder(
                    Memory.operations[id].spawnList,
                    Memory.operations[id].invasionHandler.invasions.members,
                    Memory.operations[id].invasionHandler.invasions.size,
                    Array(30).fill(RANGED_ATTACK,0,10).fill(MOVE,10,25).fill(HEAL,25,30),
                    {role: 'Hunter', operation: id}
                    );

                }
            }
        }

        static buildCreeps(id){
            let spawnList=Memory.operations[id].spawnList;
            let memberList=Memory.operations[id].members;
            let size=Memory.operations[id].size;
            let body=Memory.operations[id].default_Abody;
            let memory={role: 'MineDefender', operation: id};
            var temp=this.creepBuilder(spawnList,memberList,size,body,memory);
            Memory.operations[id].members=temp;
            Memory.operations[id].members=this.cleanUpCreeps(Memory.operations[id].members);
            // CHECK IF REACHED OR FLAG POSITION CHANGED
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
                Memory.operations[this.id].SpawnList=this.findClosestSpawn(roomName);
                Memory.operations[this.id].members={};
                Memory.operations[this.id].invasionHandler={};
                Memory.operations[this.id].invasionHandler.invasions=[];
                Memory.operations[this.id].invasionHandler.body=[];
                Memory.operations[this.id].invasionHandler.size=1;
                Memory.operations[this.id].invasionHandler.members={};


                //console.log(JSON.stringify(Memory.operations[this.id]));
            }
        }
// DONT
// MODIFY
// FUNCTIONS
// BELOW HERE
// THEY ARE FOR  FUTURE PROTOTYPES


        static findClosestSpawn(targetRoomName,addDistance=0){
            var min_dist=999;
            var spawnList=[];
            for(var i in Memory.myRooms){
                if(min_dist > Object.keys(Game.map.findRoute(targetRoomName,i)).length){
                    min_dist=Object.keys(Game.map.findRoute(targetRoomName,i)).length;
                }
            }
            min_dist +=addDistance;
            for(var j in Game.spawns){
                let dist=Object.keys(Game.map.findRoute(targetRoomName,Game.spawns[j].pos.roomName)).length;;
                if(min_dist >= Object.keys(Game.map.findRoute(Game.spawns[j].pos.roomName,targetRoomName)).length){
                    spawnList.push(j);
                }
            }
            return spawnList;
        }

        static creepBuilder(spawnList,memberList,size,body,memory){
            var out=memberList;
            if(Object.keys(out).length < size){
                for(var i in spawnList){
                    var spawn=Game.spawns[spawnList[i]];
                    if(spawn.spawning == null){
                        if(Object.keys(out).length < size){
                            if(spawn.canCreateCreep(body, undefined, memory) == OK){
                                var name=spawn.createCreep(body,undefined,memory);
                                out[name]= {};
                            }
                        }
                    }
                }
            }
            return out;
        }

        static cleanUpCreeps(members){
            var temp=members;
            for(var i in temp){
                if(!Game.creeps[i]){
                    delete temp[i];
                }
            }
            return temp;
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
