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

                if(!Memory.operations[id].toDefend){
                    if(Game.ticks % 50){
                        console.log('DEFEND OPERATION '+id+' HAS NOTHING TO DO');
                    }
                }else{
                    this.invasionHandler(id);
                    let defendId=Memory.operations[id].toDefend;
                    var keepers=[];
                    var lairs=[];
                    var creeps=[]
                    //search Sources in Operation for Keepers


                    for(var i in Memory.operations[defendId].sources){
                        if(Game.rooms[Memory.operations[defendId].roomName]){
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
                            //Increase size if  one creep is about to die
                            if(creep.ticksToLive < 300 && Memory.operations[id].size== Math.ceil(Object.keys(Memory.operations[defendId].sources).length/2) && Object.keys(Memory.operations[id].members).length == Math.ceil(Object.keys(Memory.operations[defendId].sources).length/2)){
                                Memory.operations[id].size=Math.ceil(Object.keys(Memory.operations[defendId].sources).length/2)+1;
                            }else if(Object.keys(Memory.operations[id].members).length >= Math.ceil(Object.keys(Memory.operations[defendId].sources).length/2)+1){ //Set size back if length is large or equal increased size
                                Memory.operations[id].size=Math.ceil(Object.keys(Memory.operations[defendId].sources).length/2);
                            }else if(Object.keys(Memory.operations[id].members).length < Math.ceil(Object.keys(Memory.operations[defendId].sources).length/2)){ //sset size back if length is smaller than normal size
                                Memory.operations[id].size=Math.ceil(Object.keys(Memory.operations[defendId].sources).length/2);
                            }
                            this.creepHandle(creep,id);
                        }
                    }
                }





            }
        }

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
                        if(target.ticksToSpawn  == 1 || target.ticksToSpawn >= 290){
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

        static invasionHandler(id){
            let defendId=Memory.operations[id].toDefend;

            if(Game.rooms[Memory.operations[defendId].roomName]){
                var room=Game.rooms[Memory.operations[defendId].roomName];
                var enemies=room.find(FIND_HOSTILE_CREEPS,{filter: cr => cr.owner.username != 'Source Keeper'});
                if(!Memory.operations[id].invasionHandler.invasions){
                    Memory.operations[id].invasionHandler.invasions=[];
                }
                if(enemies.length >0){
                    Memory.operations[defendId].invasion=true;
                    room.memory.invasion=true;
                    let spawnTime=Game.time-1500+enemies[0].ticksToLive;
                    if(Memory.operations[id].invasionHandler.invasions.length ==0){
                        var attackCreeps=[];
                        var healCreeps=[];
                        for(var i in enemies){
                            if(enemies[i].getActiveBodyparts(RANGED_ATTACK)> 0){
                             let cr=enemies[i];
                             var boosted=false;
                            for(var t in cr.body){
                                if(cr.body[t].boost != undefined){
                                    boosted=true;
                                }
                            }
                             console.log(JSON.stringify(cr.body));
                             console.log(boosted);
                             attackCreeps.push({id: cr.id, boost: boosted});

                            }else if(enemies[i].getActiveBodyparts(HEAL)>0){
                                 let cr=enemies[i];
                                 let boosted=_.filter(cr.body, { function(b) {if(boosted != undefined){return b} }}).length > 0;
                                 healCreeps.push({id: cr.id, boost: boosted});
                            }
                        }
                        Memory.operations[id].invasionHandler.size=attackCreeps.length;
                        Memory.operations[id].invasionHandler.invasions.push({time: spawnTime,Acrps: attackCreeps, Hcrps: healCreeps });
                    }else{
                        let length=Memory.operations[id].invasionHandler.invasions.length;
                        if(Memory.operations[id].invasionHandler.invasions[length-1].time != spawnTime && length < 10){
                            var attackCreeps=[];
                            var healCreeps=[];
                            for(var i in enemies){
                                if(enemies[i].getActiveBodyparts(RANGED_ATTACK)> 0){
                                 let cr=enemies[i];
                                 var boosted=false;
                                for(var t in cr.body){
                                    if(cr.body[t].boost != undefined){
                                        boosted=true;
                                    }
                                }

                                 console.log(JSON.stringify(cr.body));
                                 console.log(boosted);
                                 attackCreeps.push({id: cr.id, boost: boosted});

                                }else if(enemies[i].getActiveBodyparts(HEAL)>0){
                                     let cr=enemies[i];
                                     let boosted=_.filter(cr.body, { function(b) {if(boosted != undefined){return b} }}).length > 0;
                                     healCreeps.push({id: cr.id, boost: boosted});
                                }
                            }
                            Memory.operations[id].invasionHandler.size=attackCreeps.length;
                            Memory.operations[id].invasionHandler.invasions.push({time: spawnTime,Acrps: attackCreeps, Hcrps: healCreeps });
                        }else if(length == 10){
                            delete Memory.operations[id].invasionHandler.invasions;
                            Memory.operations[id].invasionHandler.invasions=[];
                        }
                    }
                    let body=Array(50).fill(TOUGH,0,4).fill(ATTACK,4,5).fill(RANGED_ATTACK,5,10).fill(MOVE,10,30).fill(HEAL,30,40);
                    Memory.operations[id].invasionHandler.members=this.creepBuilder(
                        Memory.operations[id].spawnList,
                        Memory.operations[id].invasionHandler.members,
                        Memory.operations[id].invasionHandler.size,
                        body,
                        {role: 'Hunter',operationId: id});
                    Memory.operations[id].invasionHandler.members=this.cleanUpCreeps(Memory.operations[id].invasionHandler.members);
                    for(var i in Memory.operations[id].invasionHandler.members){
                        var creep=Game.creeps[i];
                        if(!creep.spawning){
                            this.invasionBehaviour(creep,id);
                        }
                    }



                }else{
                    Memory.operations[defendId].invasion=false;
                    room.memory.invasion=false;
                    Memory.operations[id].invasionHandler.invasions.size=0;
                }
            }
        }

        static invasionBehaviour(creep,id,defendId){
            if(creep.room != Memory.operations[defendId].roomName){
                let pos = new RoomPosition(25,25,Memory.operations[defendId].roomName);
                creep.moveTo(pos);
            }else{
                if(creep.memory.targetId){
                    var target=Game.getObjectById(creep.memory.targetId);
                    if(target){
                        var range=creep.pos.getRangeTo(target);
                        if(creep.hits <= creep.hitsMax-300){
                            creep.heal(creep);
                            creep.moveTo(target);
                        }else{
                            if(range <= 1){
                                if(creep.pos.findInRange(FIND_HOSTILE_CREEPS,3).length >=1){
                                    creep.rangedMassAttack(target);
                                    creep.moveTo(target);
                                }else{
                                    creep.rangedAttack(target);
                                    creep.moveTo(target);
                                }
                            }else if(range <= 2){
                                if(creep.pos.findInRange(FIND_HOSTILE_CREEPS,3).length >=3){
                                    creep.rangedMassAttack(target);
                                    creep.moveTo(target);
                                }else{
                                    creep.rangedAttack(target);
                                    creep.moveTo(target);
                                }
                            }else if(range <= 3){
                                creep.rangedAttack(target);
                                creep.moveTo(target);
                            }else{
                                creep.moveTo(target);
                                creep.heal(creep);
                            }
                        }
                    }else{
                        delete creep.memory.targetId;
                        this.invasionBehaviour(creep,id,defendId);
                    }
                }else{
                    var enemies=creep.room.find(FIND_HOSTILE_CREEPS,{filter: creep.owner != 'Source_Keeper'});
                    creep.memory.targetId=creep.pos.findClosestByRange(enemies).id;
                    this.invasionBehaviour(creep,id,defendId);
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
