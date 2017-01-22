module.exports = class{
        constructor(){

        }
        static run(id){
            //this.checkForInvaders(Game.flags[Memory.operations[id].flagName].room);
			//Memory.operations[id].size = 3
            if (!Memory.operations[id].spawnBuilt && Game.flags[Memory.operations[id].flagName].room != undefined){ // ALREADY MY CONTROLLER? BUILD SPAWN CONSTRUCTION SITE
				if(Game.flags[Memory.operations[id].flagName].room.controller.my && !Memory.operations[id].spawn){
					Memory.operations[id].spawn = true; 
					Game.flags[Memory.operations[id].flagName].room.createConstructionSite(Game.flags[Memory.operations[id].flagName].pos.x,Game.flags[Memory.operations[id].flagName].pos.y,STRUCTURE_SPAWN); 
				}else if(!Memory.operations[id].spawnBuilt) {
					let spawns = Game.flags[Memory.operations[id].flagName].room.spawns;
					if (spawns.length){
						Memory.operations[id].spawnBuilt = true;
					}
				}else if (Game.flags[Memory.operations[id].flagName].room.controller.energyCapacityAvailable >=1000){
					spawns[0].room.minerals; // Initialize memory just in case
					spawns[0].room.sources;
					for(let cr in Memory.operations[id].members){ 
						Game.creeps[cr].memory.role="maintance";
					}
					Memory.myRooms[spawns[0].room.name]={}; // Register room in myRooms
					Game.flags[Memory.operations[id].flagName].remove(); // quit the job
				}
            }
            var creep_body = undefined;
            if (Memory.operations[id].spawnBuilt){
				creep_body = [WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE];
				Memory.operations[id].size = 4
            }else if(Game.rooms[Memory.operations[id].roomName] != undefined && Game.rooms[Memory.operations[id].roomName].controller.my){
				Memory.operations[id].size = 6
				creep_body = [WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE];
            }else{
				Memory.operations[id].size = 1
				creep_body = [TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,CLAIM,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE];
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
						console.log('Deleted '+cr +'from memory')
						delete Memory.creeps[cr];
						delete Memory.operations[id].members[cr];
					}
				}
				// RUN CREEP JOBS
				for(let cr in Memory.operations[id].members){
					if(!Game.creeps[cr].spawning && Game.creeps[cr]){
						
						if(Game.creeps[cr].pos.roomName != Game.flags[Memory.operations[id].flagName].pos.roomName){
							if(Game.time % 25 == 0)
							  console.log('Running Travel for '+cr);
							this.creepTravel(Game.creeps[cr],Game.flags[Memory.operations[id].flagName]);

						}else {
							if(Game.time % 25 == 0)
							  console.log('Running Colonization for '+cr);
							if (Game.creeps[cr].getActiveBodyparts(WORK)>0){
								this.creepColonize(Game.creeps[cr]);
							}else{
								
							}
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
                Memory.operations[this.id].refreshed=false;
                Memory.operations[this.id].members= {};
                Memory.operations[this.id].rallyPoint=Game.spawns['Spawn1'].pos.findClosestByPath(FIND_MY_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_TOWER}).id;
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
        // IDLE MOVESET
        static creepIdle(creep){
            var target = Game.getObjectById(Memory.operations[creep.memory.operation_id].rallyPoint);
            creep.moveTo(target);

        }
        // TRAVEL TO FLAG
        static creepTravel(creep,flag){
            creep.moveTo(flag);
            creep.say('travel');

        }
        // COLONIZE CODE
        static creepColonize(creep){
          // CLAIM IF NOT MY CONTROLLER
          creep.say('colonize');
          if (!creep.room.controller.my){
            console.log(creep.claimController(creep.room.controller));
            if(creep.claimController(creep.room.controller) == ERR_NOT_IN_RANGE){
              creep.moveTo(creep.room.controller);
              creep.say('Claiming');
            }
          }
          // SET JOB
          else {
            if (creep.memory.targetId == null){
              if (creep.carry.energy == creep.carryCapacity && creep.room.controller.ticksToDowngrade < 500){ // CHARGE CONTROLLER
                creep.memory.targetId = creep.room.controller.id;
              }
              else if (creep.carry.energy < creep.carryCapacity/2){ // SALVAGE
                var dropped_ressource = creep.pos.findClosestByRange(FIND_DROPPED_ENERGY);
                var containersWithEnergy = creep.room.find(FIND_STRUCTURES, {
					filter: (i) => i.structureType == STRUCTURE_CONTAINER && i.store[RESOURCE_ENERGY] > 0
				});
                if(dropped_ressource != undefined){
                    creep.memory.targetId = dropped_ressource.id;
                    creep.say('Harvesting');
                }else if(containersWithEnergy.length >0){
                    if(containersWithEnergy.length == 1){
                        var target = containersWithEnergy[0];
                    }else {
                        var target = creep.pos.findClosestByPath(containersWithEnergy);
                    }
                    if(creep.withdraw(target,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE){
                        creep.moveTo(target);
                    }

                }else {
                    var source = creep.pos.findClosestByPath(FIND_SOURCES,{filter: (s) => s.energy > 0});// HARVEST SOURCE
                    if (source != undefined)
                      creep.memory.targetId = source.id;
                      creep.say('Harvesting');
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
                var structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_CONTAINER});
                if (structure.length == 0)
                  structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_EXTENSION});
				if (structure.length == 0)
                  structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_ROAD});
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
            // DO JOB
            var target = Game.getObjectById(creep.memory.targetId);
            if (target != undefined){
              if (target.structureType == undefined){// if source
                if (creep.carry.energy == creep.carryCapacity) { 
                  creep.memory.targetId = null;
                  return this.creepColonize(creep);
                } 
                else if (creep.carry.energy < creep.carryCapacity) {
                 if(target.resourceType == RESOURCE_ENERGY){
                    if(creep.pickup(target) == ERR_NOT_IN_RANGE){
                        creep.moveTo(target);
                    }
                 }else{
                    //console.log('Pickup');
                    if(creep.harvest(target) == ERR_NOT_IN_RANGE){
                        creep.moveTo(target);
                    }
                 }
                  if(creep.harvest(target) == ERR_NOT_IN_RANGE || creep.pickup(RESOURCE_ENERGY)){
                    creep.moveTo(target);
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
                  creep.moveTo(target);
                } 
                else if (err == ERR_FULL){
                  creep.memory.targetId = null;
                }
              }
              else if(target.progress != undefined && target.structureType == STRUCTURE_CONTROLLER){
                var err = creep.upgradeController(target);
                if (err == ERR_NOT_IN_RANGE){
                  creep.moveTo(target);
                }
                else if (err == ERR_FULL){
                  creep.memory.targetId = null;
                }
              }
              else if(target.structureType != undefined){
                var err = creep.transfer(target, RESOURCE_ENERGY);
                if (err == ERR_NOT_IN_RANGE){
                  creep.moveTo(target);
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

        static refreshTimer(creep){
            var target = Game.spawns['Spawn1'];
            if(target.renewCreep(creep) == ERR_NOT_IN_RANGE){
                creep.moveTo(target)
            }else if(target.renewCreep(creep) == ERR_FULL){
                this.creep.Idle(creep);
            }
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
