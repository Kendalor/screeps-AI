var WHITELIST = {'Cade' : true,'Kendalor' : true,'Palle' : true};
var LOG_COOLDOWN = 10;
var minStructureHits = 1000;


module.exports = {
  /** @param {towerList} towerList **/
  run: function(room) {
    var enemies = room.find(FIND_HOSTILE_CREEPS,{filter: (hostile) =>
          WHITELIST[hostile.owner.username] == undefined 
        });
    var harmfulEnemies = enemies.filter((hostile) =>
			hostile.body.filter((body) => body.type == 'attack' || body.type == 'ranged_attack' || body.type == 'claim').length > 0
        );
	var invader = harmfulEnemies.filter((hostile) => hostile.owner.username == 'Invader');
	
	var towers = room.find(FIND_MY_STRUCTURES,{filter: (struct) => struct.structureType == STRUCTURE_TOWER && struct.energy > 200});
	
	// Console Info
	if (Game.time % LOG_COOLDOWN == 0){
		if (enemies.length > 0 && harmfulEnemies.length == 0){ // ONLY HARMLESS ENEMIES IN ROOM?
			console.log("Harmless enemy in room "+room.name+" !")
		}else if (harmfulEnemies.length == 1){
			if (invader.length > 0){
				console.log("Invader NPC creep in room "+room.name+" !")
			} else{	
				console.log("Harmful creep by in room "+room.name+" !")
			}
		}else if (harmfulEnemies.length > 1){
			if (invader.length >= harmfulEnemies.length - 1){
				console.log("NPC Invasion in room "+room.name+" !")
			} else{
				console.log("Player Invasion in room "+room.name+" !")
			}
		}
	}
    
	if (harmfulEnemies.length > 0){ // HARMFUL ENEMIES ?
		if (towers.length == 0){ // TOWER DEFENSE AVAILABLE?
			this.trySafeMode(room);
		}
	}
	if (enemies.length > 0) {
		this.towerDefense(towers,enemies);
	}else{
		this.towerRepair(towers);
	}
  },
  
	trySafeMode: function(room){
		if (room.controller != undefined){
			var safeMode = room.controller.safeMode
			if (safeMode == undefined){//enemyPresent and safemode off
				if (room.controller.safeModeAvailable){//safemode available
					if (Game.time % LOG_COOLDOWN == 0){
						console.log("Safemode activated in room "+room.name+" !")
					}
					room.controller.activateSafeMode()
				}
				else{
					if (Game.time % LOG_COOLDOWN == 0){
					console.log("No safemode available in room "+room.name+" !")
					}
				}
			}
			else{
				if (Game.time % LOG_COOLDOWN == 0){
				console.log("Safemode activated in room "+room.name+" : "+safeMode+" !")
				}
			}
		}else if (Game.time % LOG_COOLDOWN == 0){
			console.log("No controller")
		}
	},
	
	/** @param {towerList} towerList **/
	towerDefense: function(towerList,enemyList) {
		var tower = towerList;
		var firstPriority = enemyList.filter( (hostile) =>
			WHITELIST[hostile.owner.username] == undefined 
			&& hostile.pos.x > 1 && hostile.pos.y > 1 && hostile.pos.x < 48 && hostile.pos.y < 48 
			&& hostile.body.filter((body) => body.type == 'attack' || body.type == 'ranged_attack').length > 0);
		var secondPriority = enemyList.filter( (hostile) =>
			WHITELIST[hostile.owner.username] == undefined 
			&& hostile.pos.x > 1 && hostile.pos.y > 1 && hostile.pos.x < 48 && hostile.pos.y < 48 
			&& hostile.body.filter((body) => body.type == 'claim' || body.type == 'work').length > 0); 
		for(var i in tower){
			if(tower[i] != null) {
				var closestHostile = tower[i].pos.findClosestByRange(firstPriority);
				if (!closestHostile) closestHostile = tower[i].pos.findClosestByRange(secondPriority);
				if(closestHostile) {
					tower[i].attack(closestHostile);
				}
			}
		}
	},
	
	/** @param {towerList} towerList **/
	towerRepair: function(towerList){
		var tower = towerList;
		if (tower.length > 0){
			if (!tower[0].room.memory.structureHitsMin || tower[0].room.memory.structureHitsMin < minStructureHits){
				tower[0].room.memory.structureHitsMin = minStructureHits;
			}
			for(var i in tower){
				var minHits = tower[i].room.memory.structureHitsMin;
				if(tower[i].room.energyAvailable == tower[i].room.energyCapacityAvailable){
					var closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
						filter: (structure) => (structure.hits < structure.hitsMax-1000 && structure.structureType != STRUCTURE_RAMPART && structure.structureType != STRUCTURE_WALL)
					});
					if(!closestDamagedStructure){
						closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
						filter: (structure) => (structure.hits < minStructureHits && (structure.structureType == STRUCTURE_RAMPART))// && structure.structureType != STRUCTURE_WALL)
						});
						minHits = minStructureHits;
					}
					if(!closestDamagedStructure){
					closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
					filter: (structure) => (structure.hits < minStructureHits && (structure.structureType == STRUCTURE_WALL))// && structure.structureType != STRUCTURE_WALL)
					});
					minHits = minStructureHits;
					}
					if(!closestDamagedStructure){
					closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
					filter: (structure) => (structure.hits < tower[i].room.memory.structureHitsMin && structure.hits < structure.hitsMax-5000 && (structure.structureType == STRUCTURE_RAMPART))// && structure.structureType != STRUCTURE_WALL)
					});
					}
					if(!closestDamagedStructure){
					closestDamagedStructure = tower[i].pos.findClosestByRange(FIND_STRUCTURES, {
					filter: (structure) => (structure.hits < tower[i].room.memory.structureHitsMin && structure.hits < structure.hitsMax-5000 && (structure.structureType == STRUCTURE_WALL))// && structure.structureType != STRUCTURE_WALL)
					});
					}
					if(closestDamagedStructure) {
					if(closestDamagedStructure.structureType == STRUCTURE_WALL || closestDamagedStructure.structureType == STRUCTURE_RAMPART)
					tower[i].room.memory.structureHitsMin = closestDamagedStructure.hits;
					tower[i].repair(closestDamagedStructure);
					}
					else if(Game.time % 10 == 0 && tower[i].room.memory.structureHitsMin < 300000000){
					tower[i].room.memory.structureHitsMin += minStructureHits;
					}
				}
			}
		}
	}
	
};
