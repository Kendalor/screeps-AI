var WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true};

module.exports = class{
        
        constructor(){

        }
		
        static run(id){
			// 50 PARTS - NO RANGED ATTACK BUILD COSTS: 2300 = 28xTOUGH + 4xATTACK +1xCARRY 13xMOVE 4xHEAL
			// 47 PARTS - RANGED ATTACK COSTS: 2300 = 26xTOUGH + 3xATTACK + 1xRANGED_ATTACK +1xCARRY 12xMOVE 4xHEAL
			// 26 PARTS - BULLDOZER COSTS: 2300 = 20xWORK + 6xMOVE
			var creep_body = Array(26).fill(WORK,0,20).fill(MOVE,20,26);
			// TEST BODY : var creep_body = [TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,HEAL];
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
				// BUILD CREEPS UNTIL SQUAD SIZE REACHED

				if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size && !Memory.operations[id].members.assembled){

					if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep(creep_body, undefined, {role: 'demolisher', operation: id, target: Memory.operations[id].flagName}) == OK){
						var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep(creep_body,undefined,{role: 'demolisher', operation_id: id, target: Memory.operations[id].flagName});
						Memory.operations[id].members[name]= 'demolisher';
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
						if(Memory.operations[id].assembled==false){
							console.log('Running Refresh for'+cr);
							if(Game.creeps[cr].ticksToLive < 1400){
								this.refreshTimer(Game.creeps[cr]);
							}else{
								this.creepIdle(Game.creeps[cr]);
							}
						}else if(Memory.operations[id].assembled==true && Memory.operations[id].reached==false){
							console.log('Running Travel for '+cr);
							if (Game.creeps[cr].hits == Game.creeps[cr].hitsMax)
								this.creepTravel(Game.creeps[cr],Game.flags[Memory.operations[id].flagName]);
							else{
								Game.creeps[cr].say('Regenerating')
								this.creepLeaveBorder(Game.creeps[cr]);
								Game.creeps[cr].heal(Game.creeps[cr]);
							}

						}else if(Memory.operations[id].assembled==true && Memory.operations[id].reached==true){
							console.log('Running demolish for '+cr);
							if (Game.creeps[cr].hits > (Game.creeps[cr].body.filter((body) => body.type == HEAL).length * 200 + 150))
								this.creepAttack(Game.creeps[cr]);
							else
								this.creepEscape(Game.creeps[cr]);
						}
					}
				}
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
                Memory.operations[this.id].type='demolish';
                Memory.operations[this.id].size=1;
                Memory.operations[this.id].nearest_spawnId=this.findClosestSpawn(flag);
                Memory.operations[this.id].assembled=false;
                Memory.operations[this.id].reached=false;
                Memory.operations[this.id].refreshed=false;
                Memory.operations[this.id].members= {};
                Memory.operations[this.id].rallyPoint=Game.spawns['Spawn1'].pos.findClosestByPath(FIND_MY_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_TOWER}).id;


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
            creep.heal(creep);
            //this.creepAttack(creep);
        }
        // ATTACK CODE
        static creepAttack(creep){
			this.creepLeaveBorder(creep);
            var priorityTarget=Game.flags[Memory.operations[creep.memory.operation_id].flagName].pos.lookFor(LOOK_STRUCTURES);
            if(priorityTarget[0]){
                if(creep.dismantle(priorityTarget[0]) == ERR_NOT_IN_RANGE){
                        creep.moveTo(priorityTarget[0],{ignoreDestructibleStructures: true});
                        //console.log(creep.moveTo(priorityTarget[0],{ignoreDestructibleStructures: true, ignoreCreeps: true}));
                        creep.heal(creep);
                        creep.say('prio 1');
                    }
            }else if (creep.hits < creep.hitsMax){
                creep.heal(creep);
            }else{
                creep.memory.reached=false;
                delete creep.memory.target;
            }
        }
		
		static creepEscape(creep){
			var exit = creep.pos.findClosestByPath(FIND_EXIT)
			creep.moveTo(exit);
		}
		
		static creepLeaveBorder(creep){
			if (creep.pos.x == 0){
				switch(Game.time % 3){
					case 0:	creep.move(TOP_RIGHT); break;
					case 1: creep.move(RIGHT); break;
					case 2: creep.move(BOTTOM_RIGHT); break;
				}
			}else if(creep.pos.y == 0){
				switch(Game.time % 3){
					case 0:	creep.move(BOTTOM_RIGHT); break;
					case 1: creep.move(BOTTOM); break;
					case 2: creep.move(BOTTOM_LEFT); break;
				}
			}else if(creep.pos.x == 49){
				switch(Game.time % 3){
					case 0:	creep.move(BOTTOM_LEFT); break;
					case 1: creep.move(LEFT); break;
					case 2: creep.move(TOP_LEFT); break;
				}
			}else if(creep.pos.y == 49){
				switch(Game.time % 3){
					case 0:	creep.move(TOP_LEFT); break;
					case 1: creep.move(TOP); break;
					case 2: creep.move(TOP_RIGHT); break;
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
