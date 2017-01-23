var autoMemory = require('auto.memory');
var constants = require('var.const');
var creepRole = constants.creepRole();
var maintanceUnits = 1;
var upgradeUnits = 1;
var nonMinerRoles=['maintance','upgrader','defender','supplier'];

module.exports = {
	/** @param {StructureSpawn} Spawn **/
	run: function(spawnList) {

            var room = spawnList[0].room;


                //INIT MEMORY STRUCTURE
                if(!room.memory.roomManagement){
                    room.memory.roomManagement={};
                    room.memory.roomManagement.roles={};
                    for(var i in nonMinerRoles){
                        room.memory.roomManagement.roles[creepRole[i].name]={};
                        room.memory.roomManagement.roles[creepRole[i].name].members={};
                        room.memory.roomManagement.roles[creepRole[i].name].size=0;
                    }
                }


				// DEFENDER
				if(spawn.room.memory.underAttack){
				    room.memory.roomManagement.roles['defender']=1;
				}


				//MAINTANCE
				if(Object.keys(room.memory.roomManagement.roles['miner'].members).length == 2){
				    if (room.storage == undefined) {
						room.memory.roomManagement.roles['maintance'] = 3*Object.keys(room.memory.sources).length+Math.ceil(Math.ceil(1+parseInt(Object.keys(room.constructionSites).length)/10));;
                    }else{
				        room.memory.roomManagement.roles['maintance'] = Math.ceil(1+parseInt(Object.keys(room.constructionSites).length)/10); // 1 +Constructionsites/10
                    }
				}

				//UPGRADER
				if (room.storage == undefined) {
				    room.memory.roomManagement.roles['upgrader'] = 1;
				}else{
				    room.memory.roomManagement.roles['upgrader'] = Math.min(Math.max(parseInt(room.storage.store[RESOURCE_ENERGY]/30000)-4,0),6);
				}

				//Supplier
				if(spawn.room.storage.store.energy > 1000){
                    room.memory.roomManagement.roles['supplier'].size=1;
				}


				//HAULER UND MINER  -> WILL LATER BE SEPARATED MORE
                for(var i in room.memory.sources){
                    if(!room.memory.sources[i].haulers){
                        room.memory.sources[i].haulers={};
                    }
                    if(!room.memory.sources[i].min_haulers){
                        room.memory.sources[i].min_haulers=0;
                    }
                    if(!room.memory.sources[i].miners){
                        room.memory.sources[i].miners={};
                    }
                    if(!room.memory.sources[i].min_miners){
                        room.memory.sources[i].min_miners=1;
                    }

                    if(room.memory.sources[i].container){
                        room.memory.sources[i].min_haulers=1;
                    }else{
                        room.memory.sources[i].min_haulers=0;
                    }
                    let body=this.minerPreset(room);
                    room.memory.sources[i].miners=this.cleanUpCreeps(room.memory.sources[i].miners);
                    room.memory.sources[i].miners=this.creepBuilder(spawnList,room.memory.sources[i].miners,room.memory.sources[i].min_miners,body,{role: 'mining', source_id: i});



                    body=this.haulerPreset(room);
                    room.memory.sources[i].haulers=this.cleanUpCreeps(room.memory.sources[i].haulers);
                    room.memory.sources[i].haulers=this.creepBuilder(spawnList,room.memory.sources[i].haulers,room.memory.sources[i].min_haulers,body,{role: 'hauler', source_id: i});




                }





                for(var t in room.memory.roomManagement.roles){ //&& Game.rooms[spawn.room.name].energyAvailable

                    switch(t) {

                        case 'defender': //defender
                            var body=this.defenderPreset(room);
                            room.memory.roomManagement.roles[t].members=this.creepBuilder(spawnList,room.memory.roomManagement.roles[t].members,room.memory.roomManagement.roles[t].size,body,);
                            room.memory.roomManagement.roles[t].size
                            break;

                        case 'maintance': //maintance
                            var body=this.maintancePreset(room);

                            break;

                        case 'supplier': //supplier
                            var body=this.supplierPreset(room);

                            break;

                        case 'upgrader': //upgrader
                            var body=this.upgraderPreset(room);

                            break;
                        default:
                            console.log("auto.spawn: Undefined creep's role: "+i)
                        }
                }
            }

		}
	},

	minerPreset: function(room){

		var energyCap = room.energyCapacityAvailable;
		var moveParts = 1;
		var carryParts= 1;
		var workParts = 2;

		if (energyCap >= 950) {moveParts=6;carryParts=1;workParts=6;}
		if (energyCap < 950) {moveParts=1;carryParts=1;workParts=6;}
		if (energyCap < 800) {moveParts=1;carryParts=1;workParts=5;}
		if (energyCap < 700) {moveParts=1;carryParts=1;workParts=4;}
		if (energyCap < 500) {moveParts=2;carryParts=1;workParts=1;}

		if (room.memory.activeCreepRoles.miner == 0 && room.memory.activeCreepRoles.maintance == 0 && room.energyAvailable < energyCap) {moveParts=1;carryParts=1;workParts=2;}

		return Array(workParts).fill(WORK).concat(Array(carryParts).fill(CARRY)).concat(Array(moveParts).fill(MOVE));
	},
	
	haulerPreset: function(room,carryCap){
		if (carryCap < 10) carryCap += 2;
		var energyCap = room.energyCapacityAvailable;
		var moveParts= Math.min(Math.max(2,parseInt(energyCap/150)),parseInt(Math.ceil(carryCap/2)));
		var carryParts = parseInt(moveParts*2);

		if (room.memory.activeCreepRoles.hauler == 0 && room.memory.activeCreepRoles.maintance == 0 && room.energyAvailable < energyCap) {
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
	
	maintancePreset: function(room){
		var energyCap = Math.min(room.energyCapacityAvailable,1200);
		if (room.memory.activeCreepRoles.hauler == 0 && room.memory.activeCreepRoles.maintance == 0 && room.energyAvailable < energyCap)
			energyCap = Math.min(room.energyAvailable,1500);
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
	
	upgraderPreset: function(room){
		var energyCap = room.energyCapacityAvailable;
		var workParts = Math.max(1,parseInt(((energyCap-100)/100)));
		if (workParts > 15) workParts = 15;
		var carryParts = parseInt((energyCap-(100*workParts)-50)/50);
		if (carryParts > 3) carryParts = 3;
		var moveParts = parseInt((energyCap-(100*workParts)-50*carryParts)/50);
		if (moveParts > 6) moveParts = 6;
		return Array(workParts).fill(WORK).concat(Array(carryParts).fill(CARRY)).concat(Array(moveParts).fill(MOVE));
	},
	
	defenderPreset: function(room){
		var energyCap = room.energyCapacityAvailable;
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
	
	supplierPreset: function(room){
		var energyCap = Math.max(900,room.energyAvailable);
		var moveParts= Math.min(16,Math.max(2,parseInt(((energyCap)/3)/50)));
		var partArray = [];
		for (let i = 0; i < moveParts; i++){
			partArray = partArray.concat([CARRY,CARRY,MOVE]);
		}
		return partArray;
	},

	buildSourceRoads: function(room){
		var pathArrayArray = {};
		for (var i in room.memory.sources){
			var source = Game.getObjectById(i); 
			var path = room.findPath(source.pos,source.room.controller.pos);
			var pathArray = Room.deserializePath(Room.serializePath(path));
			for (var j=0;j<pathArray.length;j++){
				pathArrayArray[i] = source.room.createConstructionSite(pathArray[j].x,pathArray[j].y,STRUCTURE_ROAD);
			}
		}
	},

	buildSwampRoads: function(room){
		var pathArrayArray = {};
		for (var i in room.memory.sources){
		var source = Game.getObjectById(i); 
		var path = room.findPath(source.pos,source.room.controller.pos);
		var pathArray = Room.deserializePath(Room.serializePath(path));
		for (var j=0;j<pathArray.length;j++){
			if (room.lookForAt(LOOK_TERRAIN,pathArray[j].x,pathArray[j].y) == "swamp")
			pathArrayArray[i] = source.room.createConstructionSite(pathArray[j].x,pathArray[j].y,STRUCTURE_ROAD);
		}
		}
	},

	roomProfiler: function(room){
		if(!room.memory.stats){
			room.memory.stats={};
		}else{
			if(!room.memory.spawns){
				room.memory.spawns ={};
			}else{
				if(!room.memory.stats.spawns[spawn.name]){
					room.memory.stats.spawns[spawn.name] = {};
				}
			}
		}

		if(Game.ticks % 1000 == 0){
			room.memory.stats.spawns[spawn.name].utilization=Memory.rooms[room].stats.spawns[spawn.name].ticks_s/1000;
			room.memory.stats.spawns[spawn.name].ticks_s=0;
			room.memory.stats.spawns[spawn.name].waitingForEnergy=Memory.rooms[room].stats.spawns[spawn.name].ticks_e/1000;
			room.memory.stats.spawns[spawn.name].ticks_e=0;
		}else{
		if(spawn.spawning != null){
			room.memory..stats.spawns[spawn.name].ticks_s=Memory.rooms[room].stats.spawns[spawn.name].ticks_s+1;
			}else if(room.energyAvailable < spawn.room.energyCapacityAvailable){
				room.memory..stats.spawns[spawn.name].ticks_e=Memory.rooms[room].stats.spawns[spawn.name].ticks_e+1;
			}
		}
	}

	creepBuilder: function(spawnList,memberList,size,body,memory){
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

    cleanUpCreeps function(members){
            var temp=members;
            for(var i in temp){
                if(!Game.creeps[i]){
                    delete temp[i];
                }
            }
            return temp;
        }

};