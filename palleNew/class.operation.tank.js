const gap = 359;

module.exports = class{
        constructor(){

        }
        static run(id){
            //Memory.operations[this.id].default_body=Array(50).fill(WORK,0,5).fill(MOVE,5,30).fill(HEAL,30,50);
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED

                this.buildCreeps(id);
                for(var i in Memory.operations[id].members){
                    var creep=Game.creeps[i];
                    this.creepHandle(creep,id);
                }

                if(Object.keys(Memory.operations[id].members) == 0 && Memory.operations[id].size == 0){
                    var flag = Game.flags[Memory.operations[id].flagName];
                    flag.remove();
                }

            }
        }

        static creepHandle(creep,id){
            var flag=Game.flags[Memory.operations[id].flagName];
            //Game.getObjectById(Memory.operations['6579942'].spawnList[0]);
			if(flag.pos.x == 0 || flag.pos.y == 0 || flag.pos.x == 49 || flag.pos.y == 49){// Is Flag placed on exit zone?
				if(creep.hits == creep.hitsMax){
					if(creep.room.name != flag.pos.roomName || !creep.room.controller.owner){
						creep.journeyTo(Game.flags[Memory.operations[id].flagName]);
						//creep.travelTo(Game.flags[Memory.operations[id].flagName]);
						creep.heal(creep);
						var sources=creep.pos.findInRange(FIND_DROPPED_RESOURCES,1);
						if(sources.length >0){
							creep.pickup(sources[0]);
						}
					}else{
						creep.heal(creep);
						creep.drop(RESOURCE_ENERGY);
					}
				}else{
					if(creep.room.name == flag.pos.roomName){
						creep.heal(creep);
						creep.drop(RESOURCE_ENERGY);
					}else{
						var sources=creep.pos.findInRange(FIND_DROPPED_RESOURCES,1);
						if(sources.length >0){
							creep.pickup(sources[0]);
						}
                        creep.leaveBorder();
                        creep.heal(creep);
					}
				}
			}else{ // Flag is not placed on exit zone
			    if(creep.pos.roomName == flag.pos.roomName){
                    if(creep.hits >= creep.hitsMax-gap){ // creep fully alive?
                        let wounded = creep.room.find(FIND_MY_CREEPS,{filter: (c) => c.hits < c.hitsMax-gap});
                        if (wounded.length){ // found a wounded neighbour to heal?
                            creep.say("aid");
                            var mostWounded;
                            var leastHits;
                            for(var j in wounded){
                                if(wounded[j].hits < leastHits || leastHits == undefined || mostWounded == undefined){
                                    mostWounded=wounded[j];
                                    leastHits=wounded[j].hits;
                                }
                            }
                            //Get most Wounded
                            var range=creep.pos.getRangeTo(mostWounded);
                            if(range < 2){
								if(mostWounded.hits < mostWounded.hitsMax-gap){
									creep.heal(mostWounded);
								}
                            }else if(range < 4){
								if(mostWounded.hits < mostWounded.hitsMax-gap){
									creep.rangedHeal(mostWounded);
								}
                                creep.moveTo(mostWounded);//edit
                            }
                            //let targets = creep.pos.findInRange(FIND_STRUCTURES,1);
                            //if(targets.length) creep.dismantle(targets[0]);
							creep.moveTo(flag);
                        }else{ // try to engage the flag
                            creep.moveTo(flag);
                            // rage
                            let targets = [];
							//let targets = creep.pos.findInRange(FIND_HOSTILE_CREEPS,1).filter((hostile) => hostile.getActiveBodyparts(ATTACK) == 0 && !Memory.globals.ally[hostile.owner.username]);
                            //if (!targets.length){targets = creep.pos.findInRange(FIND_STRUCTURES,1);}
                            if (!targets.length){targets = creep.pos.findInRange(FIND_HOSTILE_STRUCTURES,1);}
							//if (!targets.length && creep.room.controller && creep.room.controller.owner && !Memory.globals.ally[creep.room.controller.owner.username]){targets = creep.pos.findInRange(FIND_STRUCTURES,1);}
							if (targets.length){
								creep.say("RAWR!");
								creep.attack(targets[0]);
								creep.dismantle(targets[0]);
								if(creep.hits < creep.hitsMax-(gap/2))
								    creep.heal(creep);
							}
                        }
                    //}else if(creep.hits < creep.hitsMax-(2*gap)){
                    }else if(creep.hits < creep.hitsMax-(2*gap) || creep.room.find(FIND_HOSTILE_STRUCTURES,{filter: (s) => s.structureType == STRUCTURE_TOWER && s.energy > 9 && s.pos.getRangeTo(creep) < 6}).length){ // wounded itself -> heal
                        if(creep.pos.roomName == Game.flags[Memory.operations[id].flagName].pos.roomName){
                            creep.say("flee");
                            var home=creep.pos.findClosestByPath(FIND_EXIT);
                            //let targets = creep.pos.findInRange(FIND_STRUCTURES,1);
                            //if(targets.length) creep.dismantle(targets[0]);
                            creep.moveTo(home);
							if(creep.hits < creep.hitsMax-gap)
								creep.heal(creep);
                        }else{
                            if(creep.hits < creep.hitsMax-gap){
                                this.leaveBorder(creep);
								creep.heal(creep);
                            }
                        }
                    }else{
                        creep.say("Charge!");
                        creep.moveTo(flag);
						if(creep.hits < creep.hitsMax-gap)
							creep.heal(creep);
                    }
                }else{
                    //creep.moveTo(flag);
					if(creep.hits < creep.hitsMax-gap){
					    creep.leaveBorder();
						creep.heal(creep);
						if(creep.pos.x < 3 || creep.pos.x > 47 || creep.pos.y < 3 || creep.pos.y > 47){
						    creep.say("Restore");
						}else{
						    creep.journeyTo(flag);
						    //creep.travelTo(flag);
						}
					}else{
					    creep.say("Charge!");
					    creep.journeyTo(flag);
					    //creep.travelTo(flag);
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
                //Memory.operations[this.id].default_body=Array(50).fill(ATTACK,0,1).fill(TOUGH,1,15).fill(MOVE,15,35).fill(HEAL,35,50);
                //Memory.operations[this.id].default_body=Array(50).fill(ATTACK,0,1).fill(TOUGH,1,15).fill(MOVE,15,35).fill(HEAL,35,50);
                //Memory.operations[this.id].default_body=Array(50).fill(TOUGH,0,5).fill(ATTACK,5,10).fill(MOVE,10,35).fill(HEAL,35,50);
				//Memory.operations[this.id].default_body=[TOUGH,MOVE,MOVE,MOVE,MOVE,MOVE,HEAL,HEAL,HEAL,HEAL];
				//Memory.operations[this.id].default_body=[TOUGH,TOUGH,TOUGH,TOUGH,MOVE,MOVE,MOVE,MOVE,MOVE,ATTACK,MOVE,MOVE,MOVE,MOVE,HEAL,HEAL,HEAL,HEAL];
                Memory.operations[this.id].default_body=Array(50).fill(WORK,0,10).fill(MOVE,10,35).fill(HEAL,35,50);
                //[TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL,HEAL];
                //Memory.operations[this.id].default_body=[MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,WORK,HEAL]
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
                    if(spawn.spawning == null && spawn.inactive == undefined){
                        if(Object.keys(out).length < size){
                            if(spawn.canSpawnCreep(body, undefined, memory) == OK){
                                var name=spawn.spawnCreep(body,undefined,memory);
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
