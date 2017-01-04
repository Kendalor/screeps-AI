module.exports = class{
        constructor(){

        }
        static run(id){
            //this.checkForInvaders(Game.flags[Memory.operations[id].flagName].room);
            if (!Memory.operations[id].spawnBuilt && Game.flags[Memory.operations[id].flagName].room != undefined){ // ALREADY MY CONTROLLER? BUILD SPAWN CONSTRUCTION SITE
				if(Game.flags[Memory.operations[id].flagName].room.controller.my){
					Memory.operations[id].spawn = true; 
					Game.flags[Memory.operations[id].flagName].room.createConstructionSite(Game.flags[Memory.operations[id].flagName].pos.x,Game.flags[Memory.operations[id].flagName].pos.y,STRUCTURE_SPAWN); 
				}
            }
            var creep_body = undefined;
            if (Memory.operations[id].spawnBuilt)
              creep_body = [WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE,WORK,CARRY,MOVE];
            else if(Game.rooms[Memory.operations[id].roomName] != undefined && Game.rooms[Memory.operations[id].roomName].controller.my)
				creep_body = [WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE,WORK,CARRY,MOVE,MOVE];
            else
              creep_body = [CLAIM,WORK,CARRY,MOVE,MOVE,MOVE];
            
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED

            if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size){
                //console.log('Spawning');
                //console.log(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'colonist', operation: id, target: Memory.operations[id].flagName}) == OK);
                if(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'colonist', operation: id, target: Memory.operations[id].flagName, targetId: null}) == OK){
                    var name=Game.spawns['Spawn1'].createCreep(creep_body,undefined,{role: 'colonist', operation_id: id, target: Memory.operations[id].flagName, targetId: null});
                    Memory.operations[id].members[name]= 'colonist';
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
                    
                    if(Game.creeps[cr].pos.roomName != Game.flags[Memory.operations[id].flagName].pos.roomName){
                        if(Game.time % 25 == 0)
                          console.log('Running Travel for '+cr);
                        this.creepTravel(Game.creeps[cr],Game.flags[Memory.operations[id].flagName]);

                    }else {
                        if(Game.time % 25 == 0)
                          console.log('Running Colonization for '+cr);
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
                Memory.operations[this.id].assembled=false;
                Memory.operations[this.id].reached=false;
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

        }
        // COLONIZE CODE
        static creepColonize(creep){
          // CLAIM IF NOT MY CONTROLLER
          if (!creep.room.controller.my){
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
              else if (creep.carry.energy < creep.carryCapacity/2){ // HARVEST SOURCE
                var dropped_ressource = creep.pos.findClosestByRange(FIND_DROPPED_ENERGY);
                var containersWithEnergy = creep.room.find(FIND_STRUCTURES, {
    filter: (i) => i.structureType == STRUCTURE_CONTAINER &&
                   i.store[RESOURCE_ENERGY] > 0
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
                    var source = creep.pos.findClosestByPath(FIND_SOURCES);
                    if (source != undefined)
                      creep.memory.targetId = source.id;
                      creep.say('Harvesting');
                    }
              }
              if (creep.memory.targetId == null && creep.carry.energy >= creep.carryCapacity/2){ // BUILD SPAWN
                var structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_SPAWN});
                if (structure.length){
                  creep.memory.targetId = creep.pos.findClosestByRange(structure).id;
                  creep.say('Building');
                }
              }
              if (creep.memory.targetId == null && creep.carry.energy >= creep.carryCapacity/2){ // CHARGE SPAWN & EXTENSIONS
                var structure = creep.room.find(FIND_STRUCTURES, {filter: (struct) => (struct.structureType == STRUCTURE_EXTENSION ||
                    struct.structureType == STRUCTURE_SPAWN) && struct.energy < struct.energyCapacity});
                if (structure.length > 0){
                  creep.memory.targetId = creep.pos.findClosestByRange(structure).id;
                  creep.say('Hauling');
                }
              }
              if (creep.memory.targetId == null && creep.carry.energy >= creep.carryCapacity/2){ // BUILD INFRASTRUCTURE
                var structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_CONTAINER});
                if (structure.length == 0)
                  structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_ROAD});
                if (structure.length == 0)
                  structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_EXTENSION});
                if (structure.length){
                  creep.memory.targetId = creep.pos.findClosestByRange(structure).id;
                  creep.say('Building');
                }
              }
              if (creep.memory.targetId == null && creep.carry.energy >= creep.carryCapacity/2){ // CHARGE CONTROLLER
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





};
