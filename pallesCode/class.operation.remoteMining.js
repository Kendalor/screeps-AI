

module.exports = class{
        constructor(){

        }
        static run(id){
            if (!Memory.operations[id].spawnBuilt && Game.flags[Memory.operations[id].flagName].room.controller.my){ // ALREADY MY CONTROLLER? BUILD SPAWN CONSTRUCTION SITE
              Game.flags[Memory.operations[id].flagName].room.createConstructionSite(Game.flags[Memory.operations[id].flagName].pos.x,Game.flags[Memory.operations[id].flagName].pos.y,STRUCTURE_SPAWN); 
            }
            if (Memory.operations[id].sourceId!=null){
              if (Memory.operations[id].storageId!=null){
                
                
                var creep_body = undefined;
                  creep_mine_body = [WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE];
                  creep_haul_body = [CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE];
                
                if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
                    // BUILD CREEPS UNTIL SQUAD SIZE REACHED
                    if(Object.keys(Memory.operations[id].member).length < 1){
                      if(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'remote_miner', operation: id, target: Memory.operations[id].flagName, targetId: null}) == OK){
                          var name=Game.spawns['Spawn1'].createCreep(creep_body,undefined,{role: 'remote_miner', operation_id: id, target: Memory.operations[id].flagName, targetId: null});
                          Memory.operations[id].members[name]= 'remote_miner';
                          console.log('Did spawn creep '+name);
                      }
                    }
                  /*
                  if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size && !Memory.operations[id].members.assembled){
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
                  */
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
                              console.log('Running Travel for '+cr);
                              this.creepTravel(Game.creeps[cr],Game.flags[Memory.operations[id].flagName]);

                          }else {
                              console.log('Running Colonization for '+cr);
                              this.creepColonize(Game.creeps[cr]);
                          }
                      }
                  }




                }
              }
              else{
                console.log("Mining operation needs storage");
                Game.flags[Memory.operations[id].flagName]
              }
            else{
                console.log("Mining operation needs a source at flag position");
                Game.flags[Memory.operations[id].flagName]
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
                Memory.operations[this.id].type='remoteMining';
                Memory.operations[this.id].haulerSize=0;
                Memory.operations[this.id].assembled=false;
                Memory.operations[this.id].reached=false;
                Memory.operations[this.id].refreshed=false;
                Memory.operations[this.id].members= {};
                Memory.operations[this.id].rallyPoint=Game.spawns['Spawn1'].pos.findClosestByPath(FIND_MY_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_TOWER}).id;
                
                Memory.operations[this.id].sourceId=room.find(FIND_SOURCES,{filter: (source) => source.pos.x == flag.pos.x && source.pos.y == flag.pos.y && source.pos.roomName == flag.pos.roomName})[0];
                Memory.operations[this.id].storageId=null;
                Memory.operations[this.id].containerId=null;
                Memory.operations[this.id].containerPos=null;


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
              creep.say('Upgrading');
            }
          }
          // SET JOB
          else {
            if (creep.memory.targetId == null && creep.carry.energy == creep.carryCapacity && creep.room.controller.ticksToDowngrade < 500){ //
              creep.memory.targetId = creep.room.controller.id;
            }
            else if (creep.memory.targetId == null && creep.carry.energy < creep.carryCapacity/2){
              var source = creep.pos.findClosestByRange(FIND_SOURCES);
              if (source != undefined)
                creep.memory.targetId = source.id;
                creep.say('Harvesting');
            } 
            else if (creep.memory.targetId == null && creep.carry.energy >= creep.carryCapacity/2){
              var structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_SPAWN});
              if (structure == null)
                structure = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_ROAD});
              if (structure.length){
                creep.memory.targetId = creep.pos.findClosestByRange(structure).id;
                creep.say('Building');
              }
            }
            else if (creep.memory.targetId == null && creep.carry.energy >= creep.carryCapacity/2){
              var structure = creep.room.find(FIND_STRUCTURES, {filter: (struct) => (struct.structureType == STRUCTURE_EXTENSION ||
                  struct.structureType == STRUCTURE_SPAWN) && struct.energy < struct.energyCapacity});
              if (structure.length){
                creep.memory.targetId = creep.pos.findClosestByRange(structure).id;
                creep.say('Hauling');
              }
            }
            else if (creep.memory.targetId == null && creep.carry.energy == creep.carryCapacity){
              creep.memory.targetId = creep.room.controller.id;
              creep.say('Upgrading');
            }
            // DO JOB
            var target = Game.getObjectById(creep.memory.targetId);
            if (target != undefined){
              if (target.structureType == undefined && creep.carry.energy == creep.carryCapacity) { // if source and full
                creep.memory.targetId = null;
                this.creepColonize(creep);
              } 
              else if (target.structureType == undefined && creep.carry.energy < creep.carryCapacity) { // if source and not full
                if(creep.harvest(target) == ERR_NOT_IN_RANGE) {
                  creep.moveTo(target);
                }
              }
              else if (target.structureType != undefined && creep.carry.energy == 0) { // if not source
                creep.memory.targetId = null;
                this.creepColonize(creep);
              } 
              else if(target.progress != undefined && target.structureType != STRUCTURE_CONTROLLER){
                if(creep.build(target) == ERR_NOT_IN_RANGE) {
                  creep.moveTo(target);
                }
              }
              else if(target.progress != undefined && target.structureType == STRUCTURE_CONTROLLER){
                if (creep.upgradeController(target) == ERR_NOT_IN_RANGE)
                  creep.moveTo(target);
              }
              else if(target.structureType != undefined){
                if (creep.transfer(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE)
                  creep.moveTo(target);
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

        static creepMine(creep){
          if(Game.time % 10 == 0){
            creep.say('mining');
          }
          if(creep.carry.energy < creep.carryCapacity){
            var source = Game.getObjectById(Memory.operations[creep.memory.operation_id].sourceId);
            if(creep.harvest(source) == ERR_NOT_IN_RANGE) {
              creep.moveTo(source);
            }
          }
          if(creep.carry.energy >= 0){
            var container = Game.getObjectById(Memory.operations[creep.memory.operation_id].containerId);
            var pos = creep.room.memory.sources[creep.memory.source].containerPos;
            if(container == null && creep.carry.energy>30){
              var constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.pos.x == pos.x && site.pos.y == pos.y});
              if (constructions[0] != null){
                if (creep.build(constructions[0]) == ERR_NOT_IN_RANGE){
                  creep.build(constructions[0]);
                }
              }
              else{
                var containers = creep.room.find(FIND_STRUCTURES,{filter: (struct) => struct.structureType == STRUCTURE_CONTAINER && struct.pos.x == pos.x && struct.pos.y == pos.y});            
                Game.getObjectById(Memory.operations[creep.memory.operation_id].containerId = containers[0].id;
              }
            } 
            else if(container != null){
              if(creep.pos.x != pos.x || creep.pos.y != pos.y){
                creep.moveTo(pos.x,pos.y);
              }
              else{
                creep.drop(RESOURCE_ENERGY);
              }
            }
          }
        }

        static haul(creep){
          
        }

};
