

module.exports = class{
        constructor(){

        }
        static run(id){
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED
				if(!Memory.operations[id].spawnList){
                    Memory.operations[id].spawnList=this.findClosestSpawn(Game.flags[Memory.operations[id].flagName].pos.roomName,1);
                }
				let body=[WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE];
				Memory.operations[id].members = this.creepBuilder(Memory.operations[id].spawnList,Memory.operations[id].members,Memory.operations[id].size,body,{role: 'remote_builder', operation_id: id});
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
					if(!Game.creeps[cr].spawning && Game.creeps[cr]){
						
						if(Game.creeps[cr].pos.roomName != Game.flags[Memory.operations[id].flagName].pos.roomName && Game.creeps[cr].carry.energy == Game.creeps[cr].carryCapacity){
							if(Game.time % 5 == 0)
							  Game.creeps[cr].say("travel");
							this.creepTravel(Game.creeps[cr],Game.flags[Memory.operations[id].flagName]);
						}else if (Game.creeps[cr].pos.roomName != Memory.operations[id].storageRoomName && Game.creeps[cr].carry.energy == 0){
							if(Game.time % 5 == 0)
							  Game.creeps[cr].say("gather");
							if (!this.creepGather(Game.creeps[cr]))
								this.creepTravel(Game.creeps[cr],Game.rooms[Memory.operations[id].storageRoomName].storage);
						}else if (Game.creeps[cr].pos.roomName == Game.flags[Memory.operations[id].flagName].pos.roomName && Game.creeps[cr].carry.energy > 0){
							if(Game.time % 5 == 0)
							  Game.creeps[cr].say("build");
							this.leaveBorder(Game.creeps[cr]);
							this.creepBuild(Game.creeps[cr]);
						}else{
							if(Game.time % 5 == 0)
							  Game.creeps[cr].say("gather");
							this.creepGather(Game.creeps[cr]);
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
                Memory.operations[this.id].type='remote_build';
                Memory.operations[this.id].size=1;
                Memory.operations[this.id].refreshed=false;
                Memory.operations[this.id].members= {};
                Memory.operations[this.id].rallyPoint=Game.spawns['Spawn1'].pos.findClosestByPath(FIND_MY_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_TOWER}).id;
                Memory.operations[this.id].storageRoomName=this.findClosestStorageRoom(flag);


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
        // IDLE MOVESET
        static creepIdle(creep){
            var target = Game.getObjectById(Memory.operations[creep.memory.operation_id].rallyPoint);
            creep.moveTo(target);

        }
        // TRAVEL TO FLAG
        static creepTravel(creep,flag){
            creep.moveTo(flag);

        }
        // BUILD CODE
		static creepBuild(creep) {
			if (!creep.memory.targetId){
				var constructions = [];
				if(constructions.length == 0 && creep.room.controller && creep.room.controller.level >= 2) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_EXTENSION });}
				if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_CONTAINER});}
				if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_STORAGE});}
				if(constructions.length == 0 && creep.room.controller && creep.room.controller.level >= 3) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_TOWER});}
				if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_ROAD});}
				if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_WALL});}
				if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES);}
				if(constructions.length > 0){
					creep.memory.targetId = creep.pos.findClosestByRange(constructions).id;
				}else{
					if (Game.flags[Memory.operations[creep.memory.operation_id].flagName].pos.roomName != Memory.operations[creep.memory.operation_id].roomName){
						let pos = new RoomPosition(1, 1, Memory.operations[creep.memory.operation_id].roomName);
						Game.flags[Memory.operations[creep.memory.operation_id].flagName].setPosition(pos);
					}else{
						creep.memory.role="maintance";
						Game.flags[Memory.operations[creep.memory.operation_id].flagName].remove();
					}
				}
			}else{
				var target = Game.getObjectById(creep.memory.targetId);
				if (target != undefined){
					var err = creep.build(target)
					if(err == ERR_NOT_IN_RANGE) {
						creep.moveTo(target);
					}else if(err == ERR_INVALID_TARGET){
						delete creep.memory.targetId;
					}
				}else{
					delete creep.memory.targetId;
				}
			}
		}
		
		static leaveBorder(creep){
			if (creep.pos.x == 0) creep.move(RIGHT);
			else if(creep.pos.y == 0) creep.move(BOTTOM);
			else if(creep.pos.x == 49) creep.move(LEFT);
			else if(creep.pos.y == 49) creep.move(TOP);
		}
		
		// GATHER CODE
		static creepGather(creep) {
			let target;
			if (creep.memory.targetId){
				target = Game.getObjectById(creep.memory.targetId);
				if (!target || target.progress || target.store[RESOURCE_ENERGY] < creep.carryCapacity){
					target = null;
					delete creep.memory.targetId;
				}
			}
			if(!creep.memory.targetId){
				target = creep.room.storage;
				if (target){
					target = target.store[RESOURCE_ENERGY] >= creep.carryCapacity? target : null;
				}else{
					let containers = creep.room.containers.filter((c) => c.store[RESOURCE_ENERGY] >= creep.carryCapacity);
					if (containers.length >= 1){
						target = creep.pos.findClosestByPath(containers);
					}
				}
			}
			if (target && creep.withdraw(target,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
				creep.moveTo(target);
				return true;
			}else{
				return false;
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
};