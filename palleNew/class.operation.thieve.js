

module.exports = class{
        constructor(){

        }
        static run(id){
            if(!this.checkForDelete(id)){
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED
				if(!Memory.operations[id].spawnList){
                    Memory.operations[id].spawnList=this.findClosestSpawn(Game.flags[Memory.operations[id].flagName].pos.roomName,1);
                }
				let body=[CARRY,MOVE,CARRY,MOVE,CARRY,MOVE,CARRY,MOVE,CARRY,MOVE,CARRY,MOVE,CARRY,MOVE,CARRY,MOVE,CARRY,MOVE,CARRY,MOVE,CARRY,MOVE,CARRY,MOVE]; // 1200 = 12MOVE+12CARRY
				Memory.operations[id].members = this.creepBuilder(Memory.operations[id].spawnList,Memory.operations[id].members,Memory.operations[id].size,body,{role: 'thief', operation_id: id});
				for(var cr in Memory.operations[id].members){
					// DELETE NONEXISTING CREEPS FROM OPERATION
					if(!Game.creeps[cr]) {
						console.log('Deleted '+cr +' from memory')
						delete Memory.creeps[cr];
						delete Memory.operations[id].members[cr];
					}

				}
				// RUN CREEP JOBS
				for(var cr in Memory.operations[id].members){
					if(Game.creeps[cr] && !Game.creeps[cr].spawning){
						this.thieve(id,Game.creeps[cr]);
					}
				}
				// REMOVE FLAG IF members.length == size == 0
				if (Memory.operations[id].size == 0 && Memory.operations[id].members == Memory.operations[id].size){
					let flag = Game.flags[Memory.operations[id].flagName];
					flag.remove();
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
                Memory.operations[this.id].type='thieve';
                Memory.operations[this.id].size=1;
                Memory.operations[this.id].members= {};
                Memory.operations[this.id].storageRoomName=this.findClosestStorageRoom(flag);
				Memory.operations[this.id].pathLength = parseInt(2.15*PathFinder.search(Game.rooms[Memory.operations[this.id].storageRoomName].storage.pos,Game.flags[Memory.operations[this.id].flagName].pos).path.length);
				Memory.operations[this.id].complete = false;

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
		
		static findClosestStorageRoom(flagName){
            var min_length;
            var best_storage;
            var new_length;
            for(var i in Game.spawns){
				if (Game.spawns[i].room.storage != undefined){
					new_length = Object.keys(Game.map.findRoute(Game.spawns[i].room.name,Game.flags[flagName].pos.roomName)).length;
					if(new_length < min_length  || min_length == undefined){
						min_length=new_length;
						best_storage=Game.spawns[i].room.name;
					}
				}
            }
            return best_storage;
        }
		
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
		
		static thieve(id,creep){
			let flag = Game.flags[Memory.operations[id].flagName];
			let homeRoomName = Memory.operations[id].storageRoomName;
			
			/*
			*	CASES:
			*			CREEP HAS ENERGY
			*				IN HOME ROOM 				-> FILL STORAGE , BECOME SUPPLIER IF COMPLETE, SUICIDE IF TTL LOW
			*				NOT IN HOME ROOM			-> GOTO FLAG
			*			CREEP HAS NO ENERGY
			*				IN FLAG ROOM
			*					NO MEMORIZED STORAGE	-> MEMORIZE IT OR SET COMPLETE TRUE
			*					HAS STORAGE W ENERGY	-> STEAL ENERGY
			*				NOT IN FLAG ROOM			-> GOTO HOME STORAGE
			*/
			if(creep.carry.energy > 0 || Memory.operations[id].complete){	// CREEP HAS ENERGY
				if(creep.pos.roomName == homeRoomName){									// IN HOME ROOM
					if(creep.inRangeTo(creep.room.storage,1)){									// FILL STORAGE
						creep.transfer(creep.room.storage, RESOURCE_ENERGY);
						if(Memory.operations[id].complete){										// BECOME SUPPLIER IF COMPLETE
							delete creep.memory;
							creep.memory;
							creep.memory.role = "supplier";
							Memory.operations[id].size--;
							delete Memory.operations[id].members[creep.name];
						}else if(creep.ticksToLive < Memory.operations[id].pathLength){			 // SUICIDE IF TTL LOW
							delete creep.memory;
							creep.suicide();
						}
					}else{ 												
						creep.travelTo(creep.room.storage);
					}
				}else{ 																	// NOT IN HOME ROOM
					creep.journeyTo(Game.rooms[Memory.operations[id].storageRoomName].storage);
				}
			}else{																//CREEP HAS NO ENERGY
				if(creep.pos.roomName == flag.pos.roomName){							// IN FLAG ROOM
					if(!creep.memory.storageId){												// NO MEMORIZED STORAGE
						let storages = creep.room.find(FIND_STRUCTURES,{filter: (s) => s.structureType == STRUCTURE_STORAGE && (s.store.energy > 0 || s.store.length>1)});
						if(storages.length == 0){
							Memory.operations[this.id].complete = true;
							creep.memory.storageId = "";
						}else if(storages.length > 1){
							storages = storages.filter((s) => !s.my);
							creep.memory.storageId = storages[0].id;
						}else{
							creep.memory.storageId = storages[0].id;
						}
					}
					let storage = Game.getObjectById(creep.memory.storageId);
					if(storage){														// HAS STORAGE W ENERGY
						if(creep.inRangeTo(storage,1)){
							creep.withdraw(storage, RESOURCE_ENERGY);
							delete creep.memory.storageId;
						}else{											
							creep.travelTo(storage);
						}
					}else{
						Memory.operations[this.id].complete = true;
					}
				}else{																	// NOT IN FLAG ROOM
					creep.journeyTo(flag);
				}
			}
		}
};