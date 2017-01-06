

module.exports = class{
        constructor(){

        }
        static run(id){
            //var creep_body = [WORK,CARRY,MOVE];//only for testing
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED
				if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size){
					// BODY COST 1150: 4xWORK= 400 + 6*CARRY = 300 + 5xMOVE= 250 
					var creep_body = [WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE];
					//console.log('Spawning');
					//console.log(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'remoteBuilder', operation: id, target: Memory.operations[id].flagName}) == OK);
					if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep(creep_body, undefined, {role: 'remoteBuilder', operation: id, target: Memory.operations[id].flagName}) == OK){
						var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep(creep_body,undefined,{role: 'remoteBuilder', operation_id: id, target: Memory.operations[id].flagName});
						Memory.operations[id].members[name]= 'remoteBuilder';
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
						
						if(Game.creeps[cr].pos.roomName != Game.flags[Memory.operations[id].flagName].pos.roomName && Game.creeps[cr].carry.energy == Game.creeps[cr].carryCapacity){
							if(Game.time % 5 == 0)
							  console.log('Running Travel for '+cr);
							this.creepTravel(Game.creeps[cr],Game.flags[Memory.operations[id].flagName]);
						}else if (Game.creeps[cr].pos.roomName != Memory.operations[id].storageRoomName && Game.creeps[cr].carry.energy == 0){
							if(Game.time % 5 == 0)
							  console.log('Running Travel for '+cr);
							this.creepTravel(Game.creeps[cr],Game.rooms[Memory.operations[id].storageRoomName].storage);
						}else if (Game.creeps[cr].pos.roomName == Game.flags[Memory.operations[id].flagName].pos.roomName && Game.creeps[cr].carry.energy > 0){
							if(Game.time % 5 == 0)
							  console.log('Running Build for '+cr);
							this.leaveBorder(Game.creeps[cr]);
							this.creepBuild(Game.creeps[cr]);
						}else{
							if(Game.time % 5 == 0)
							  console.log('Running Gather for '+cr);
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
                Memory.operations[this.id].assembled=false;
                Memory.operations[this.id].reached=false;
                Memory.operations[this.id].nearest_spawnId=this.findClosestSpawn(flag);
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
				if(constructions.length == 0 && creep.room.controller.level >= 2) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_EXTENSION });}
				if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_CONTAINER});}
				if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_STORAGE});}
				if(constructions.length == 0 & creep.room.controller.level >= 3) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_TOWER});}
				if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_ROAD});}
				if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_WALL});}
				if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES);}
				if(constructions.length > 0){
					creep.memory.targetId = creep.pos.findClosestByRange(constructions).id;
				}else{
					Game.flags[Memory.operations[creep.memory.operation_id].flagName].remove();
					creep.suicide();
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
			var storage = creep.room.storage
			if(creep.withdraw(storage,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
				creep.moveTo(storage);
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
};