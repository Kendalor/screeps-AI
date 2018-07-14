var autoMemory = require('auto.memory');
var constants = require('var.const');
var creepRole = constants.creepRole();
var maintanceUnits = 1;
var upgradeUnits = 1;
var supplierUnits = 1;


module.exports = {
	/** @param {StructureSpawn} Spawn **/
	run: function(spawnList) {

		//for every spawn in the list
        //for(var id in spawnList) {
		if (spawnList.length){
            var spawn = spawnList[spawnList.length-1];
            var room = spawn.room;
            var ctrlLvl = spawn.room.controller.level;
            //if(spawn.spawning == null){
            if(spawn.spawning == null && spawn.inactive == undefined){
                //this.roomProfiler(spawn);

                if (!spawn.room.memory.activeCreepRoles){
                    spawn.room.memory.activeCreepRoles = {};
                }



                var minerAmount = spawn.room.memory.activeCreepRoles.miner = _.filter(room.myCreeps, (creep) => creep.memory.role==creepRole[0].name).length;
                var haulerAmount = spawn.room.memory.activeCreepRoles.hauler = _.filter(room.myCreeps, (creep) => creep.memory.role==creepRole[1].name).length;
                var maintanceAmount = spawn.room.memory.activeCreepRoles.maintance = _.filter(room.myCreeps, (creep) => creep.memory.role==creepRole[2].name).length;
                var supplierAmount = spawn.room.memory.activeCreepRoles.supplier = _.filter(room.myCreeps, (creep) => creep.memory.role==creepRole[5].name).length;
                var upgraderAmount = spawn.room.memory.activeCreepRoles.upgrader = _.filter(room.myCreeps, (creep) => creep.memory.role==creepRole[3].name).length;
                var defenderAmount = spawn.room.memory.activeCreepRoles.defender = _.filter(room.myCreeps, (creep) => creep.memory.role==creepRole[4].name).length;
                

				if (spawn.room.memory.sources){
					if (spawn.room.storage == undefined) {
						if(spawn.room.energyCapacityAvailable>=700){
							maintanceUnits = 2*Object.keys(spawn.room.memory.sources).length//+Math.ceil(Math.ceil(1+parseInt(Object.keys(spawn.room.constructionSites).length)/10));;
						}else if(spawn.room.energyCapacityAvailable>=500){
							maintanceUnits = 5*Object.keys(spawn.room.memory.sources).length//+Math.ceil(Math.ceil(1+parseInt(Object.keys(spawn.room.constructionSites).length)/10));;
						}else{
							let slots = 0;
							for (let id in spawn.room.memory.sources){
								slots += spawn.room.memory.sources[id].slots;
							}
							maintanceUnits = Math.max(slots,4*Object.keys(spawn.room.memory.sources).length);
						}
						upgradeUnits = 1;
					}else{
					    if(ctrlLvl < 8){
						    upgradeUnits = Math.min(Math.max(parseInt(spawn.room.storage.store[RESOURCE_ENERGY]/30000)-4,0),6);
					    }else{
					        upgradeUnits = 1;//Math.min(Math.max(parseInt(spawn.room.storage.store[RESOURCE_ENERGY]/30000)-12,0),6);
					    }
						maintanceUnits = Math.ceil(1+parseInt(Object.keys(spawn.room.constructionSites).length)/10); // 1 +Constructionsites/10
					}
				}else{
					spawn.room.sources;
				}
				if(ctrlLvl > 5){
				    supplierUnits = 2;
				}

                //for every type of creep
                var canSpawnMaxModuleCreep = (0 == spawn.canSpawnCreep(Array(Game.rooms[spawn.room.name].energyCapacityAvailable/50).fill(MOVE)));
                if ((spawn.room.memory.activeCreepRoles.miner == 0 || spawn.room.memory.activeCreepRoles.hauler == 0) && spawn.room.energyAvailable == 200){
                    canSpawnMaxModuleCreep = true;
                }
                for(i=0;i<creepRole.length && Game.rooms[spawn.room.name].energyAvailable;i++){ //&& Game.rooms[spawn.room.name].energyAvailable
                    var sources = spawn.room.memory.sources;


                    //check for amount of creep types in room


                    switch(i) {

                        case 4: //defender
                            if (spawn.room.memory.underAttack && defenderAmount == 0){
                                //spawn.spawnCreep(this.defenderPreset(spawn), undefined, {role: creepRole[4].name});
                                let body = this.defenderPreset(spawn);
                                if(spawn.canSpawnCreep(body) == OK);
                                    spawn.spawnCreep(body, undefined, {role: creepRole[4].name});
                            }
                            break;

                        case 0: //miner
                            if(sources && minerAmount < Object.keys(sources).length){
                                for(let id in sources){
                                    let body = this.minerPreset(spawn);
                                    if(spawn.canSpawnCreep(body) == OK){
                                        if(!spawn.room.memory.sources[id].requiredCarryParts){
                                            autoMemory.resetSourceMemory(spawn.room);
                                        }
                                        var found = true;
                                        //console.log("miner: "+spawn.room.find(FIND_MY_CREEPS,{filter: (creep) => creep.memory.source == id && creep.memory.role == 'miner'}));
                                        if(spawn.room.myCreeps.filter((creep) => creep.memory.source == id && creep.memory.role == 'miner' && creep.ticksToLive > 24+2*spawn.room.memory.sources[id].requiredCarryParts).length == 0 && found){
                                            //spawn.spawnCreep(this.minerPreset(spawn), undefined, {role: creepRole[0].name, source: id, spawn: true});
                                            spawn.spawnCreep(body, undefined, {role: creepRole[0].name, source: id, spawn: true});
                                            found = false;
                                        }
                                    }
                                }
                            }

                            break;


                        case 1: //hauler
                            //console.log('need to spawn?');
                            //console.log(minerAmount >= haulerAmount && haulerAmount < (Object.keys(sources).length));
                            if(sources && minerAmount >= haulerAmount && haulerAmount < (Object.keys(sources).length)){ // spawned when storage is available
                                for(let id in sources){
                                    if(!spawn.room.memory.sources[id].requiredCarryParts){
                                        autoMemory.resetSourceMemory(spawn.room);
                                    }
                                    var found = true;
                                    //console.log("hauler: "+spawn.room.find(FIND_MY_CREEPS,{filter: (creep) => creep.memory.source == id && creep.memory.role == 'hauler'}));
                                    //console.log('container existis ? in room '+ spawn.room.name);
                                    //console.log(spawn.room.memory.sources[id].container);
                                    if (spawn.room.memory.sources[id].container){
                                        if(spawn.room.myCreeps.filter((creep) => creep.memory.source == id && creep.memory.role == 'hauler' && creep.ticksToLive > (6+8*spawn.room.memory.sources[id].requiredCarryParts) ).length == 0 && found){
                                            //console.log(this.haulerPreset(spawn,spawn.room.memory.sources[id].requiredCarryParts))
                                            //console.log(spawn.spawnCreep(this.haulerPreset(spawn,spawn.room.memory.sources[id].requiredCarryParts), undefined, {role: creepRole[1].name, source: id, spawn:true}));
                                            //spawn.spawnCreep(this.haulerPreset(spawn,spawn.room.memory.sources[id].requiredCarryParts), undefined, {role: creepRole[1].name, source: id, spawn:true});
                                            let body = this.haulerPreset(spawn,spawn.room.memory.sources[id].requiredCarryParts);
                                            if(spawn.canSpawnCreep(body) == OK){
                                                spawn.spawnCreep(body, undefined, {role: creepRole[1].name, source: id, spawn:true});
                                                found = false;
                                            }
                                        }
                                    }
                                }
                            }
                            break;

                        case 2: //maintance
                            if(sources && minerAmount >= (Object.keys(sources).length) && maintanceAmount < maintanceUnits){
                                //spawn.spawnCreep(this.maintancePreset(spawn), undefined, {role: creepRole[2].name});
                                let body = this.maintancePreset(spawn);
                                if(spawn.canSpawnCreep(body) == OK){
                                    spawn.spawnCreep(body, undefined, {role: creepRole[2].name});
                                }
                            }
                            break;

                        case 5: //supplier
                            if(supplierAmount < supplierUnits && spawn.room.storage && spawn.room.storage.store.energy > 1000){
                                //spawn.spawnCreep(this.supplierPreset(spawn), undefined, {role: creepRole[5].name});
                                let body = this.supplierPreset(spawn);
                                if(spawn.canSpawnCreep(body) == OK){
                                    spawn.spawnCreep(body, undefined, {role: creepRole[5].name});
                                }
                            }
                            break;

                        case 3: //upgrader
                            if(upgraderAmount < upgradeUnits && spawn.room.storage != undefined && minerAmount == Object.keys(sources).length && haulerAmount == Object.keys(sources).length){
                                //spawn.spawnCreep(this.upgraderPreset(spawn), undefined, {role: creepRole[3].name, workModules: 15});
                                let body = this.upgraderPreset(spawn);
                                if(spawn.canSpawnCreep(body) == OK){
                                    spawn.spawnCreep(body, undefined, {role: creepRole[3].name, workModules: 15});
                                }
                            }
                            break;


                        default:
                            console.log("auto.spawn: Undefined creep's role: "+i)
                        }
                }
            }

		}
	},

	minerPreset: function(spawn){

		var energyCap = spawn.room.energyCapacityAvailable;
		var moveParts = 1;
		var carryParts= 1;
		var workParts = 2;

		if (energyCap >= 950) {moveParts=6;carryParts=1;workParts=6;}
		if (energyCap < 950) {moveParts=1;carryParts=1;workParts=6;}
		if (energyCap < 800) {moveParts=1;carryParts=1;workParts=5;}
		if (energyCap < 700) {moveParts=1;carryParts=1;workParts=4;}
		if (energyCap < 500) {moveParts=2;carryParts=1;workParts=1;}

		if (spawn.room.memory.activeCreepRoles.miner == 0 && spawn.room.memory.activeCreepRoles.maintance == 0 && spawn.room.energyAvailable < energyCap) {moveParts=1;carryParts=1;workParts=2;}

		return Array(workParts).fill(WORK).concat(Array(carryParts).fill(CARRY)).concat(Array(moveParts).fill(MOVE));
	},
	
	haulerPreset: function(spawn,carryCap){
		if (carryCap < 10) carryCap += 2;
		var energyCap = spawn.room.energyCapacityAvailable;
		var moveParts= Math.min(Math.max(2,parseInt(energyCap/150)),parseInt(Math.ceil(carryCap/2)));
		var carryParts = parseInt(moveParts*2);

		if (spawn.room.memory.activeCreepRoles.hauler == 0 && spawn.room.memory.activeCreepRoles.maintance == 0 && spawn.room.energyAvailable < energyCap) {
			moveParts=2;carryParts=4;
			return Array(carryParts).fill(CARRY).concat(Array(moveParts).fill(MOVE));
		}else{
			var partArray = [];
			for (let i = 0; i < moveParts; i++){
				partArray = partArray.concat([CARRY,CARRY,MOVE]);
			}
			return partArray;
		}
	},
	
	maintancePreset: function(spawn){
		var energyCap = Math.min(spawn.room.energyCapacityAvailable,1200);
		if (spawn.room.memory.activeCreepRoles.hauler == 0 && spawn.room.memory.activeCreepRoles.maintance == 0 && spawn.room.energyAvailable < energyCap)
			energyCap = Math.min(spawn.room.energyAvailable,1500);
		var moveParts = Math.min(Math.max(1,parseInt(energyCap/200)),4);
		var carryParts = moveParts;
		var workParts = moveParts;
		if (energyCap <= 300) {
			moveParts=2;carryParts=1;workParts=1;
		}else{
			var partArray = [];
			for (let i = 0; i < moveParts; i++){
				partArray = partArray.concat([WORK,CARRY,MOVE]);
			}
			return partArray;
		}
		return Array(workParts).fill(WORK).concat(Array(carryParts).fill(CARRY)).concat(Array(moveParts).fill(MOVE));
	},
	
	upgraderPreset: function(spawn){
		var energyCap = spawn.room.energyCapacityAvailable;
		var workParts = Math.max(1,parseInt(((energyCap-100)/100)));
		if (workParts > 15) workParts = 15;
		var carryParts = parseInt((energyCap-(100*workParts)-50)/50);
		if (carryParts > 3) carryParts = 3;
		var moveParts = parseInt((energyCap-(100*workParts)-50*carryParts)/50);
		if (moveParts > 8) moveParts = 8;
		return Array(workParts).fill(WORK).concat(Array(carryParts).fill(CARRY)).concat(Array(moveParts).fill(MOVE));
	},
	
	defenderPreset: function(spawn){
		var energyCap = spawn.room.energyCapacityAvailable;
		var moveParts = 2;
		var attackParts = 2;
		var toughParts = 0;

		if (energyCap >= 1050) {moveParts=5;toughParts=0;attackParts=10;}
		if (energyCap < 950) {moveParts=4;toughParts=0;attackParts=8;}
		if (energyCap < 800) {moveParts=4;toughParts=0;attackParts=7;}
		if (energyCap < 700) {moveParts=3;toughParts=0;attackParts=6;}
		if (energyCap < 500) {moveParts=2;toughParts=0;attackParts=2;}

		if (toughParts > 0){
			return Array(toughParts).fill(TOUGH).concat(Array(moveParts).fill(MOVE)).concat(Array(attackParts).fill(ATTACK));
		}
		else {
			return Array(moveParts).fill(MOVE).concat(Array(attackParts).fill(ATTACK));
		}
	},
	
	supplierPreset: function(spawn){
		var energyCap = Math.max(900,spawn.room.energyAvailable);
		var moveParts= Math.min(16,Math.max(2,parseInt(((energyCap)/3)/50)));
		var partArray = [];
		for (let i = 0; i < moveParts; i++){
			partArray = partArray.concat([CARRY,CARRY,MOVE]);
		}
		return partArray;
	},

	buildSourceRoads: function(spawn){
		var pathArrayArray = {};
		for (var i in spawn.room.memory.sources){
			var source = Game.getObjectById(i); 
			var path = spawn.room.findPath(source.pos,source.room.controller.pos);
			var pathArray = Room.deserializePath(Room.serializePath(path));
			for (var j=0;j<pathArray.length;j++){
				pathArrayArray[i] = source.room.createConstructionSite(pathArray[j].x,pathArray[j].y,STRUCTURE_ROAD);
			}
		}
	},

	buildSwampRoads: function(spawn){
		var pathArrayArray = {};
		for (var i in spawn.room.memory.sources){
		var source = Game.getObjectById(i); 
		var path = spawn.room.findPath(source.pos,source.room.controller.pos);
		var pathArray = Room.deserializePath(Room.serializePath(path));
		for (var j=0;j<pathArray.length;j++){
			if (spawn.room.lookForAt(LOOK_TERRAIN,pathArray[j].x,pathArray[j].y) == "swamp")
			pathArrayArray[i] = source.room.createConstructionSite(pathArray[j].x,pathArray[j].y,STRUCTURE_ROAD);
		}
		}
	},

	roomProfiler: function(spawn){
		var room = spawn.room.name;
		if(!Memory.rooms[room].stats){
			Memory.rooms[room].stats={};
		}else{
			if(!Memory.rooms[room].stats.spawns){
				Memory.rooms[room].stats.spawns ={};
			}else{
				if(!Memory.rooms[room].stats.spawns[spawn.name]){
					Memory.rooms[room].stats.spawns[spawn.name] = {};
				}
			}
		}

		if(Game.ticks % 1000 == 0){
			Memory.rooms[room].stats.spawns[spawn.name].utilization=Memory.rooms[room].stats.spawns[spawn.name].ticks_s/1000;
			Memory.rooms[room].stats.spawns[spawn.name].ticks_s=0;
			Memory.rooms[room].stats.spawns[spawn.name].waitingForEnergy=Memory.rooms[room].stats.spawns[spawn.name].ticks_e/1000;
			Memory.rooms[room].stats.spawns[spawn.name].ticks_e=0;
		}else{
		if(spawn.spawning != null){
			Memory.rooms[room].stats.spawns[spawn.name].ticks_s=Memory.rooms[room].stats.spawns[spawn.name].ticks_s+1;
			}else if(spawn.room.energyAvailable < spawn.room.energyCapacityAvailable){
				Memory.rooms[room].stats.spawns[spawn.name].ticks_e=Memory.rooms[room].stats.spawns[spawn.name].ticks_e+1;
			}
		}
	}

};