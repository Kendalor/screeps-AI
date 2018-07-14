var WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true,'dragoonreas' : true,'KermitFrog' : true};

module.exports = class{
        
        constructor(){

        }
		static run(id){
			//if(Game.time >= 17078852){
				//Memory.operations[id].members['David']= 'attacker';
				//Memory.operations[id].size=4;
				//var creep_body = [ATTACK,ATTACK,ATTACK,ATTACK,MOVE,MOVE,MOVE,MOVE];
				//var creep_body = [MOVE,MOVE,MOVE,ATTACK,RANGED_ATTACK,HEAL];
				//var creep_body = [TOUGH,MOVE,MOVE,MOVE,MOVE,MOVE,ATTACK,ATTACK,ATTACK,ATTACK,RANGED_ATTACK,MOVE];
				//var creep_body = [TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,ATTACK,ATTACK,ATTACK,RANGED_ATTACK,MOVE,HEAL];
				//let creep_body = Array(50).fill(ATTACK,0,5).fill(MOVE,5,32).fill(RANGED_ATTACK,32,42).fill(HEAL,42,50);
				//let creep_body = Array(50).fill(TOUGH,0,5).fill(MOVE,5,30).fill(RANGED_ATTACK,30,35).fill(ATTACK,35,45).fill(HEAL,45,50);
				let creep_body = Array(50).fill(TOUGH,0,5).fill(MOVE,5,30).fill(ATTACK,30,31).fill(RANGED_ATTACK,31,45).fill(HEAL,45,50);
				//let creep_body = Array(50).fill(MOVE,0,20).fill(RANGED_ATTACK,20,40).fill(HEAL,40,50);
				
				//var creep_body = [TOUGH,MOVE,MOVE,MOVE,MOVE,MOVE,RANGED_ATTACK,RANGED_ATTACK,RANGED_ATTACK,ATTACK,MOVE,HEAL];
				//var creep_body = [TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,MOVE,MOVE,MOVE,MOVE,MOVE,ATTACK,ATTACK,ATTACK,ATTACK,HEAL];
				//var creep_body = Array(50).fill(TOUGH,0,5).fill(MOVE,5,30).fill(ATTACK,30,50);
				//var creep_body = Array(50).fill(MOVE,0,25).fill(ATTACK,25,50);
				//var creep_body = [MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,HEAL,HEAL];
				//var creep_body = [MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,ATTACK,HEAL,HEAL];
				//var creep_body = Array(15).fill(MOVE).concat(Array(13).fill(ATTACK)).concat(Array(2).fill(HEAL)); // Needs 2290 Energy
				if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
					// BUILD CREEPS UNTIL SQUAD SIZE REACHED
					this.calcEscapeExit(id);

					if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size && !Memory.operations[id].members.assembled){
						//console.log('Spawning');
						//console.log(Game.getObjectById(Memory.operations[id].nearest_spawnId).canSpawnCreep(creep_body, undefined, {role: 'attacker', operation: id, target: Memory.operations[id].flagName}));
						if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canSpawnCreep(creep_body, undefined, {role: 'attacker', operation: id, target: Memory.operations[id].flagName}) == OK){
							//var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).spawnCreep(creep_body,undefined,{role: 'attacker', operation_id: id, target: Memory.operations[id].flagName});
							var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).spawnCreep(creep_body,undefined,{role: 'attacker', operation_id: id, target: Memory.operations[id].flagName});
							Memory.operations[id].members[name]= 'attacker';
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

                        var flag = Game.flags[Memory.operations[id].flagName];
						if(Memory.operations[id].reached==false && Memory.operations[id].assembled==true){
							if(Game.creeps[cr].inRangeTo(flag,2)){
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
					var flag=Game.flags[Memory.operations[id].flagName];
					for(var cr in Memory.operations[id].members){
						if(!Game.creeps[cr].spawning && Game.creeps[cr]){

							var creep=Game.creeps[cr];

							if(flag.pos.roomName != creep.pos.roomName){
								//console.log('Running Travel for '+cr);
								this.creepTravel(Game.creeps[cr],Game.flags[Memory.operations[id].flagName]);

							}else{
								//console.log('Running Attack for '+cr);
								this.creepAttack(Game.creeps[cr]);

							}
						}
					}
				}
			//}
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
                Memory.operations[this.id].type='attack';
                Memory.operations[this.id].size=1;
                Memory.operations[this.id].nearest_spawnId=this.findClosestSpawn(flag);
                Memory.operations[this.id].assembled=false;
                Memory.operations[this.id].reached=false;
                Memory.operations[this.id].refreshed=false;
                Memory.operations[this.id].members= {};
                //Memory.operations[this.id].rallyPoint=Game.spawns['Spawn1'].pos.findClosestByPath(FIND_MY_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_TOWER}).id;


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
            creep.journeyTo(target);
            //creep.travelTo(target);

        }
        // TRAVEL TO FLAG
        static creepTravel(creep,flag){
            creep.journeyTo(flag);
            creep.heal(creep);
            //this.creepAttack(creep);

        }
        // ATTACK CODE
        static creepAttack(creep){
            if(_.filter(creep.body, (part) => part.type == HEAL ).length >0){
                var healables=creep.pos.findClosestByPath(creep.room.myCreeps,{filter: (creep) => creep.hits < creep.hitsMax})
            }
            var priorityTarget=Game.flags[Memory.operations[creep.memory.operation_id].flagName].pos.lookFor(LOOK_STRUCTURES);
            var closestHostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS,{filter: (hostile) =>
              WHITELIST[hostile.owner.username] == undefined 
			  
              && hostile.pos.x > 0 && hostile.pos.y > 0 && hostile.pos.x < 49 && hostile.pos.y < 49 
              && hostile.body.filter((body) => body.type == 'attack' || body.type == 'ranged_attack' || body.type == 'claim').length > 0
            });
            var closestHostile_all = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS,{filter: (hostile) =>
              WHITELIST[hostile.owner.username] == undefined
			  //&& hostile.carry.energy > 0 // for killing creeps which haul energy
              && hostile.pos.x > 0 && hostile.pos.y > 0 && hostile.pos.x < 49 && hostile.pos.y < 49 });
            var closestStr = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES,{filter: (str) => (str.structureType == STRUCTURE_TOWER || str.structureType == STRUCTURE_SPAWN || str.structureType == STRUCTURE_EXTENSION) && WHITELIST[str.owner.username] == undefined, ignoreDestructibleStructures: false});
            var spawn = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_TOWER && WHITELIST[str.owner.username] == undefined,ignoreDestructibleStructures: false});
            var hostileConstruction=creep.pos.findClosestByRange(FIND_HOSTILE_CONSTRUCTION_SITES,{filter: (str) => WHITELIST[str.owner.username] == undefined,ignoreDestructibleStructures: false});
            //console.log(hostileConstruction);
            if(priorityTarget[0]){
                //console.log(creep.name);
                //console.log(priorityTarget);
                //console.log(creep.attack(priorityTarget));
                creep.say('PRIO');
                this.attackManeuver(creep,priorityTarget[0]);
            }else if(closestHostile){
                creep.say('RAWR');
                this.attackManeuver(creep,closestHostile);
            }else if(closestHostile_all){
                creep.say('RAWR');
                this.attackManeuver(creep,closestHostile_all);
            }else if(closestStr){
                //console.log('TEST5');
                if(creep.attack(closestStr) == ERR_NOT_IN_RANGE){
					creep.rangedAttack(closestStr);
                    creep.moveTo(closestStr,{ignoreDestructibleStructures: false});
                    creep.heal(creep);
                    creep.say('3attacking 3');
                }
				creep.rangedMassAttack();
            }else if(hostileConstruction != null){
                creep.moveTo(hostileConstruction);
				creep.rangedMassAttack();

            }else if(healables != null){

                if(creep.heal(healables) == ERR_NOT_IN_RANGE){
                    creep.moveTo(healables);
                }

            }else{
                //console.log('TEST3');
                creep.memory.reached=false;
                delete creep.memory.target;
				let flag = Game.flags[Memory.operations[creep.memory.operation_id].flagName];
				if(!creep.inRangeTo(flag,3)){
					creep.moveTo(flag);
				}
            }
        }
        
        static attackManeuver(creep,target){
            var range = creep.pos.getRangeTo(target);
            var rangedAttacked = false;
            switch(range){
                case 1:/*
                    if(creep.rangedMassAttack() == OK){
                        rangedAttacked = undefined;
                    }else{
                        creep.attack(target);
                    }
                case 2:*/
                    if(rangedAttacked == undefined || creep.rangedAttack(target) == OK){
                        rangedAttacked = true;
                        var x,y;
                        var roomExit = creep.pos.findClosestByPath(Memory.operations[creep.memory.operation_id].escapeExit);
                        var escapePath = creep.room.findPath(creep.pos, roomExit, {
                            costCallback: function(roomName, costMatrix) {
                        	    creep.room.hostileCreeps.forEach(function(hostile) {
                        	        for (x = hostile.pos.x-2;(x<hostile.pos.x+2 || x < 50) && x >=0;x++){
                        	            for (y = hostile.pos.y-2;(y<hostile.pos.y+2 || y < 50) && y >=0;y++){
                        	                costMatrix.set(x, y, 30);
                        	            }
                        	        }
                        		})
                        	}
                        });
                        creep.moveByPath(escapePath);
                        break;
                    }
                case 3:
                    creep.moveTo(target,{ignoreDestructibleStructures: false});
                case 2:
                    if(rangedAttacked || creep.rangedAttack(target) == OK){
                        if(creep.hits < creep.hitsMax){
                            creep.heal(creep);
                        }
                        break;
                    }
                default:
                    creep.moveTo(target,{ignoreDestructibleStructures: false});
                    if(creep.hits < creep.hitsMax){
                        creep.heal(creep);
                    }
            }
            /*
            if(creep.inRangeTo(target,3)){
                if(creep.rangedAttack(target) == OK){
                    if(creep.inRangeTo(target,2)){
                        let x,y;
                        //let centerPos = new RoomPosition(25, 25, creep.room.name);
                        let roomExit = creep.pos.findClosestByPath(Memory.operations[creep.memory.operation_id].escapeExit);
                        let escapePath = creep.room.findPath(creep.pos, roomExit, {
                            costCallback: function(roomName, costMatrix) {
                        	    creep.room.hostileCreeps.forEach(function(hostile) {
                        	        for (x = hostile.pos.x-2;(x<hostile.pos.x+2 || x < 50) && x >=0;x++){
                        	            for (y = hostile.pos.y-2;(y<hostile.pos.y+2 || y < 50) && y >=0;y++){
                        	                costMatrix.set(x, y, 30);
                        	            }
                        	        }
                        		})
                        	}
                        });
                        creep.moveByPath(escapePath);
                    }
                }else{
                    creep.moveTo(target,{ignoreDestructibleStructures: true});
                    creep.rangedMassAttack();
                    creep.attack(target);
                }
            }else{
                creep.moveTo(target,{ignoreDestructibleStructures: true});
                creep.rangedMassAttack();
                if(creep.hits < creep.hitsMax){
                    creep.heal(creep);
                }
            }
            */
        }

        static refreshTimer(creep){
            var target = Game.spawns['Spawn1'];
            if(target.renewCreep(creep) == ERR_NOT_IN_RANGE){
                creep.moveTo(target)
            }else if(target.renewCreep(creep) == ERR_FULL){
                this.creep.Idle(creep);
            }
        }

        static calcEscapeExit(id){
            var flag = Game.flags[Memory.operations[id].flagName];
            var currentRoomName = flag.pos.roomName;
            if(currentRoomName != Memory.operations[id].roomName){
                Memory.operations[id].roomName = currentRoomName;
                var spawn = Game.getObjectById(Memory.operations[id].nearest_spawnId);
                Memory.operations[id].escapeExit = Game.map.findExit(currentRoomName, spawn.pos.roomName);
            }
        }




};
