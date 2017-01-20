

module.exports = class{
        constructor(){

        }
        static run(id){


            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED

                this.buildCreeps(id);
                for(var i in Memory.operations[id].members){
                    var creep=Game.creeps[i];
                    this.creepHandle(creep,id);
                }



            }
        }

        static creepHandle(creep,id){
            var flag=Game.flags[Memory.operations[id].flagName];
            var home=Game.getObjectById(Memory.operations[id].nearestSpawnId);
			if(flag.pos.x == 0 || flag.pos.y == 0 || flag.pos.x == 49 || flag.pos.y == 49){// Is Flag placed on exit zone?
				if(creep.hits == creep.hitsMax){
					if(creep.room.name != flag.pos.roomName || !creep.room.controller.owner){
						creep.moveTo(Game.flags[Memory.operations[id].flagName]);
						creep.heal(creep);
						var sources=creep.pos.findInRange(FIND_DROPPED_ENERGY,1);
						if(sources.length >0){
							creep.pickup(sources[0]);
						}
					}else{
						creep.heal(creep);
						creep.drop(RESOURCE_ENERGY);
					}
				}else{
					if(creep.room.name == flag.pos.roomName){
						//creep.move(home);
						creep.heal(creep);
						creep.drop(RESOURCE_ENERGY);
					}else{
						var sources=creep.pos.findInRange(FIND_DROPPED_ENERGY,1);
						if(sources.length >0){
							creep.pickup(sources[0]);
						}
                        this.leaveBorder(creep);
                        creep.heal(creep);
					}
				}
			}else{ // Flag is not placed on exit zone
				if(creep.hits == creep.hitsMax){ // creep fully alive?
					let wounded = creep.pos.findInRange(FIND_MY_CREEPS,1,{filter: (c) => c.hits < c.hitsMax});
					if (wounded.length){ // found a wounded neighbour to heal?
						creep.say("aid");
						creep.heal(wounded[0]);
					}else{ // try to engage the flag
						creep.say("Charge!");
						creep.moveTo(flag);
						creep.heal(creep);
					}
				}else{ // wounded itself -> heal
				    if(creep.pos.roomName == Game.flags[Memory.operations[id].flagName].pos.roomName){
                        creep.say("flee");
                        creep.moveTo(home);
                        creep.heal(creep);
                    }else{
                        this.leaveBorder(creep);
                        creep.heal(creep);
                    }
				}
			}
        }

        static buildCreeps(id){
            let spawnList=Memory.operations[id].spawnList;
            let memberList=Memory.operations[id].members;
            let size=Memory.operations[id].size;
            let body=Memory.operations[id].default_body;
            let memory={role: 'Tank', operation: id};
            Memory.operations[id].members=this.creepBuilder(spawnList,memberList,size,body,memory);
            Memory.operations[id].members=this.cleanUpCreeps(Memory.operations[id].members);
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
                Memory.operations[this.id].size=1;
                Memory.operations[this.id].members= {};
                Memory.operations[this.id].spawnList=this.findClosestSpawn(roomName,1);
                Memory.operations[this.id].default_body=Array(50).fill(ATTACK,0,1).fill(TOUGH,1,23).fill(MOVE,23,40).fill(HEAL,40,50);


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
