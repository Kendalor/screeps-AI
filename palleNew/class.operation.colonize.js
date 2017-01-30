module.exports = class{
        constructor(){

        }
        static run(id){
			//this.checkForInvaders(Game.flags[Memory.operations[id].flagName].room);
			//Memory.operations[id].size = 3
			if (Game.flags[Memory.operations[id].flagName].room != undefined){ // ALREADY MY CONTROLLER? BUILD SPAWN CONSTRUCTION SITE
				if(Game.flags[Memory.operations[id].flagName].room.controller.my && !Memory.operations[id].spawn){
					Memory.operations[id].spawn = true;
					this.initSourceMemory(Game.flags[Memory.operations[id].flagName].room); // Initialize source memory
					Game.flags[Memory.operations[id].flagName].room.createConstructionSite(Game.flags[Memory.operations[id].flagName].pos.x,Game.flags[Memory.operations[id].flagName].pos.y,STRUCTURE_SPAWN); 
				}else if(!Memory.operations[id].spawnBuilt) {
					let spawns = Game.flags[Memory.operations[id].flagName].room.spawns;
					if (spawns && spawns.length){
						Memory.operations[id].spawnBuilt = true;
					}
				}else if (Game.flags[Memory.operations[id].flagName].room.energyCapacityAvailable >=1000){
					Game.flags[Memory.operations[id].flagName].room.minerals; // Initialize memory just in case
					Game.flags[Memory.operations[id].flagName].room.sources;
					for(let cr in Memory.operations[id].members){ 
						Game.creeps[cr].memory.role="maintance";
					}
					Memory.myRooms[Game.flags[Memory.operations[id].flagName].room.name]={}; // Register room in myRooms
					delete Memory.flags[Memory.operations[id].flagName];
					Game.flags[Memory.operations[id].flagName].remove(); // quit the job
					delete Memory.operations[id];
				}
			}
			var creep_body = undefined;
			if (Memory.operations[id].spawnBuilt){
				//creep_body = [WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE];
				creep_body = [WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE]; // 1000
				Memory.operations[id].size = 6;
				if (Game.rooms[Memory.operations[id].roomName].hostileCreeps.filter((hostile) =>
						hostile.body.filter((body) => body.type == 'attack' || body.type == 'ranged_attack').length > 0
					).length){
					Game.rooms[Memory.operations[id].roomName].controller.activateSafeMode();
				}
			}else if(Game.rooms[Memory.operations[id].roomName] != undefined && Game.rooms[Memory.operations[id].roomName].controller.my){
				Memory.operations[id].size = 6;
				//creep_body = [WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE];
				creep_body = [WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE]; // 1000
			}else{
				Memory.operations[id].size = 1
				creep_body = [CLAIM,MOVE]; // Claimer suicides after claiming - no need for much more
			}
			if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
				// BUILD CREEPS UNTIL SQUAD SIZE REACHED
				if(!Memory.operations[id].spawnList){
					Memory.operations[id].spawnList=this.findClosestSpawn(Game.flags[Memory.operations[id].flagName].pos.roomName,1);
				}
				Memory.operations[id].members = this.creepBuilder(Memory.operations[id].spawnList,Memory.operations[id].members,Memory.operations[id].size,creep_body,{role: 'colonist', operation_id: id});
				// CHECK IF REACHED OR FLAG POSITION CHANGED
				for(var cr in Memory.operations[id].members){
					// DELETE NONEXISTING CREEPS FROM OPERATION
					if(!Game.creeps[cr]) {
						if (Memory.creeps[cr]){
							if (Memory.creeps[cr].targetId){
								let target = Game.getObjectById(Memory.creeps[cr].targetId);
								if (target && target.memory && target.memory.harvesters){
									delete target.memory.harvesters[cr];
								}
							}
							delete Memory.creeps[cr];
						}
						delete Memory.operations[id].members[cr];
						console.log('Deleted '+cr +' from memory');
					}
				}
				// RUN CREEP JOBS
				for(let cr in Memory.operations[id].members){
					if(!Game.creeps[cr].spawning && Game.creeps[cr]){
						
						if(Game.creeps[cr].pos.roomName != Game.flags[Memory.operations[id].flagName].pos.roomName){
							this.creepTravel(Game.creeps[cr],Game.flags[Memory.operations[id].flagName]);

						}else {
							this.creepColonize(Game.creeps[cr]);
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
                Memory.operations[this.id].type='colonize';
                Memory.operations[this.id].size=1;
                Memory.operations[this.id].members= {};
                Memory.operations[this.id].spawn=false;


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

        // TRAVEL TO FLAG
        static creepTravel(creep,flag){
            //creep.travelTo(flag);
			creep.journeyTo(flag);
            creep.say('travel');

        }
        // COLONIZE CODE
        static creepColonize(creep){
          // CLAIM IF NOT MY CONTROLLER
          if (!creep.room.controller.my){
            if(creep.claimController(creep.room.controller) == ERR_NOT_IN_RANGE){
              creep.travelTo(creep.room.controller);
              creep.say('Claiming');
            }else{/*
				if(creep.room.controller.owner.username != 'undefined' && !creep.room.controller.my){
					console.log("Cannot claim "+creep.room.name);
					/* optional cancel
					delete Memory.flags[Memory.operations[id].flagName];
					Game.flags[Memory.operations[id].flagName].remove(); // quit the job
					delete Memory.operations[id];
					
				}else{*/
					creep.suicide();
				//}
			}
          }
          // SET JOB
          else{
			if(!this.renewCreep(creep)){
            if (creep.memory.targetId == null){
              if (creep.carry.energy == creep.carryCapacity && creep.room.controller.ticksToDowngrade < 500){ // CHARGE CONTROLLER
                creep.memory.targetId = creep.room.controller.id;
              }
              else if (creep.carry.energy < creep.carryCapacity/2){ // SALVAGE
                var dropped_ressource = creep.pos.findClosestByRange(FIND_DROPPED_ENERGY);
                var containersWithEnergy = creep.room.containers.filter(
					(c) => c.store[RESOURCE_ENERGY] > 0
				);
                if(dropped_ressource != undefined){
                    creep.memory.targetId = dropped_ressource.id;
                    creep.say('Picking');
                }else if(containersWithEnergy.length >0){
                    if(containersWithEnergy.length == 1){
                        var target = containersWithEnergy[0];
                    }else {
                        var target = creep.pos.findClosestByPath(containersWithEnergy);
                    }
                    if(creep.withdraw(target,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE){
                        creep.travelTo(target);
                    }

                }else {
                    var source = creep.pos.findClosestByPath(creep.room.sources,{filter : (s) => s.energy > 0 
						&& ( !s.memory.harvesters
						|| Object.keys(s.memory.harvesters).length <= s.memory.slots ) // SLOTS+1 HARVESTERS -> 1 HARVESTER ON WAITLIST
					});// HARVEST SOURCE
                    if (source != undefined){
                      creep.memory.targetId = source.id;
					  if (!source.memory.harvesters){ 
						source.memory.harvesters = {};
					  }
					  source.memory.harvesters[creep.name]=true;
                      creep.say('Harvesting');
					}
				}
              }
              if (creep.memory.targetId == null && creep.carry.energy >= creep.carryCapacity/4){ // BUILD SPAWN
                var structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_SPAWN});
                if (structure.length){
                  creep.memory.targetId = creep.pos.findClosestByRange(structure).id;
                  creep.say('Building');
                }
              }
              if (creep.memory.targetId == null && creep.carry.energy >= creep.carryCapacity/4){ // CHARGE SPAWN & EXTENSIONS
                var structure = creep.room.find(FIND_STRUCTURES, {filter: (struct) => (struct.structureType == STRUCTURE_EXTENSION ||
                    struct.structureType == STRUCTURE_SPAWN) && struct.energy < struct.energyCapacity});
                if (structure.length > 0){
                  creep.memory.targetId = creep.pos.findClosestByRange(structure).id;
                  creep.say('Hauling');
                }
              }
              if (creep.memory.targetId == null && creep.carry.energy >= creep.carryCapacity/4){ // BUILD INFRASTRUCTURE
                var structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_EXTENSION});
				if (structure.length == 0)
                  structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_CONTAINER});
                if (structure.length == 0)
                  structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_ROAD});
				if (structure.length == 0)
                  structure = creep.room.find(FIND_CONSTRUCTION_SITES);
                if (structure.length){
                  creep.memory.targetId = creep.pos.findClosestByRange(structure).id;
                  creep.say('Building');
                }
              }
              if (creep.memory.targetId == null && creep.carry.energy >= creep.carryCapacity/4){ // CHARGE CONTROLLER
                creep.memory.targetId = creep.room.controller.id;
                creep.say('Upgrading');
              }
            }
			//REPAIR ROAD IF NECESSARY
			let road = creep.pos.lookFor(LOOK_STRUCTURES).filter((obj) => obj.structureType 
				&& !obj.progress 
				&& obj.structureType == STRUCTURE_ROAD 
				&& obj.hits < obj.hitsMax-10);
			if (road.length && creep.carry.energy > 0){
				creep.repair(road[0]);
			}
            // DO JOB
            var target = Game.getObjectById(creep.memory.targetId);
            if (target != undefined){
              if (target.structureType == undefined){// if source
                if (creep.carry.energy == creep.carryCapacity) {
				  if (target.memory.harvesters){
					delete target.memory.harvesters[creep.name];
				  }
                  delete creep.memory.targetId;
                  return this.creepColonize(creep);
                } 
                else if (creep.carry.energy < creep.carryCapacity) {
                 if(target.resourceType == RESOURCE_ENERGY){
                    if(creep.pickup(target) == ERR_NOT_IN_RANGE){
                        creep.travelTo(target);
                    }
                 }else{
                    if(creep.harvest(target) == ERR_NOT_IN_RANGE){
                        creep.travelTo(target);
                    }
                 }
                  if(creep.harvest(target) == ERR_NOT_IN_RANGE || creep.pickup(RESOURCE_ENERGY)){
                    creep.travelTo(target);
                  }
                }
              }
              else if (target.structureType != undefined && creep.carry.energy == 0) { // if not source
                creep.memory.targetId = null;
                this.creepColonize(creep);
              } 
              else if(target.progress != undefined && target.structureType != STRUCTURE_CONTROLLER){
                var err = creep.build(target);
                if(err == ERR_NOT_IN_RANGE) {
                  creep.travelTo(target);
                }
                else if (err == ERR_FULL){
                  creep.memory.targetId = null;
                }
              }
              else if(target.progress != undefined && target.structureType == STRUCTURE_CONTROLLER){
                var err = creep.upgradeController(target);
                if (err == ERR_NOT_IN_RANGE){
                  creep.travelTo(target);
                }
                else if (err == ERR_FULL){
                  creep.memory.targetId = null;
                }
              }
              else if(target.structureType != undefined){
                var err = creep.transfer(target, RESOURCE_ENERGY);
                if (err == ERR_NOT_IN_RANGE){
                  creep.travelTo(target);
                }
                else if (err == ERR_FULL){
                  creep.memory.targetId = null;
                }
              }
              else 
                console.log(target);
            }
            else{ // ELSE IDLE 
              creep.memory.targetId = null;
              creep.say('Idle');
            }
          }
		  }
        }
		
		static renewCreep(creep){
			let spawns = creep.room.spawns;
			if (spawns.length && creep.room.energyAvailable >= 100 && (creep.ticksToLive < 100 || creep.memory.renewing) && creep.ticksToLive < 1450){
				if (!creep.memory.renewing){
					creep.memory.renewing = true;
					if(creep.memory.targetId){
						let target = Game.getObjectById(creep.memory.targetId);
							if (target && target.memory && target.memory.harvesters){
								delete target.memory.harvesters[creep.name];
							}
						delete creep.memory.targetId;
					}
				}
				let nearSpawn = creep.pos.findClosestByPath(spawns);
				if (creep.inRangeTo(nearSpawn,1)){
					nearSpawn.renewCreep(creep);
					creep.say('zzz');
				}else{
					creep.travelTo(nearSpawn);
				}
			}else{
				if (creep.memory.renewing){
					delete creep.memory.renewing;
				}
			}
			return creep.memory.renewing;
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

		static initSourceMemory(room){
			let sources = room.sources
			for (let i in sources){
				// Calc slots
				let source = sources[i];
				source.slots;

				// Calc ContainerPos
				var path = room.findPath(source.pos,source.room.controller.pos,{ignoreCreeps: true});
				var pathArray = Room.deserializePath(Room.serializePath(path));
				source.memory.containerPos = {}
				source.memory.containerPos.x = pathArray[0].x;
				source.memory.containerPos.y = pathArray[0].y;
				source.memory.containerPos.roomName = source.room.name;
				source.memory.requiredCarryParts = Math.ceil((pathArray.length) * 2/5)+1;
				for (var j=1;j<pathArray.length;j++){
					if (room.lookForAt(LOOK_TERRAIN,pathArray[j].x,pathArray[j].y) == "swamp"){
						source.room.createConstructionSite(pathArray[j].x,pathArray[j].y,STRUCTURE_ROAD);
					}
				}
			}
		}

};
