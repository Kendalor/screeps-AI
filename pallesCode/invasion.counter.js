var WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true};
var LOG_COOLDOWN = 10;
var MIN_DEF_STRUCTURE_HITS = 5000;

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
	
	var towers = room.find(FIND_MY_STRUCTURES,{filter: (struct) => struct.structureType == STRUCTURE_TOWER && struct.energy > 9});
	
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
		if (!room.memory.underAttack)
			room.memory.underAttack == true; //Set Memory Variable underAttack
	}else{
		this.towerRepair(towers);
		if (room.memory.underAttack)
			delete room.memory.underAttack;
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
			&& hostile.pos.x > 0 && hostile.pos.y > 0 && hostile.pos.x < 49 && hostile.pos.y < 49 
			&& hostile.body.filter((body) => body.type == ATTACK || body.type == RANGED_ATTACK).length > 0);
		var secondPriority = enemyList.filter( (hostile) =>
			WHITELIST[hostile.owner.username] == undefined 
			&& hostile.pos.x > 0 && hostile.pos.y > 0 && hostile.pos.x < 49 && hostile.pos.y < 49 
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
		var offCooldown = Game.time % 50 == 0;
		var tower = towerList;
		if (tower.length > 0){
			var spawnHasEnoughEnergy = (tower[0].room.energyAvailable > 700)
			if (spawnHasEnoughEnergy){
				if (!tower[0].room.memory.structureHitsMin || tower[0].room.memory.structureHitsMin < MIN_DEF_STRUCTURE_HITS){
					tower[0].room.memory.structureHitsMin = MIN_DEF_STRUCTURE_HITS;
				}
				var minHits = tower[0].room.memory.structureHitsMin;
				var closestDamagedStructure = undefined;
				if(!closestDamagedStructure){
					closestDamagedStructure = tower[0].pos.findClosestByRange(FIND_STRUCTURES, { // FIND REALLY BAD SHAPE RAMPARTS
					filter: (structure) => (structure.hits < MIN_DEF_STRUCTURE_HITS && (structure.structureType == STRUCTURE_RAMPART))
					});
					minHits = MIN_DEF_STRUCTURE_HITS;
				}
				if(!closestDamagedStructure){
					closestDamagedStructure = tower[0].pos.findClosestByRange(FIND_STRUCTURES, { // FIND REALLY BAD SHAPE WALLS
					filter: (structure) => (structure.hits < MIN_DEF_STRUCTURE_HITS && (structure.structureType == STRUCTURE_WALL))
					});
					minHits = MIN_DEF_STRUCTURE_HITS;
				}
				if(!closestDamagedStructure){
					closestDamagedStructure = tower[0].pos.findClosestByRange(FIND_STRUCTURES, { // FIND NON DEFENSE STRUCTURES
						filter: (structure) => (structure.hits < structure.hitsMax-1000 && structure.structureType != STRUCTURE_RAMPART && structure.structureType != STRUCTURE_WALL)
					});
				}
				if(!closestDamagedStructure){
					closestDamagedStructure = tower[0].pos.findClosestByRange(FIND_STRUCTURES, { // FIND RAMPARTS
					filter: (structure) => (structure.hits < tower[0].room.memory.structureHitsMin && structure.hits < structure.hitsMax-5000 && (structure.structureType == STRUCTURE_RAMPART))// && structure.structureType != STRUCTURE_WALL)
					});
				}
				if(!closestDamagedStructure){
					closestDamagedStructure = tower[0].pos.findClosestByRange(FIND_STRUCTURES, { // FIND WALLS
					filter: (structure) => (structure.hits < tower[0].room.memory.structureHitsMin && structure.hits < structure.hitsMax-5000 && (structure.structureType == STRUCTURE_WALL))// && structure.structureType != STRUCTURE_WALL)
					});
				}
				for(var i in tower){
					if(closestDamagedStructure && tower[i].energy > 300) {
						if(closestDamagedStructure.structureType == STRUCTURE_WALL || closestDamagedStructure.structureType == STRUCTURE_RAMPART)
							tower[i].room.memory.structureHitsMin = closestDamagedStructure.hits; // SET NEW MINIMUM HITS FOR DEFENSE STRUCTURES
						tower[i].repair(closestDamagedStructure); // ACTUALLY REPAIR SOMETHING
					}
					else if(tower[i].room.memory.structureHitsMin < 300000 && offCooldown){
						tower[i].room.memory.structureHitsMin += MIN_DEF_STRUCTURE_HITS; // INCREASE THE REPAIR THRESHOLD FOR DEFENSE STRUCTURES
					}
				}
			}
		}
	}
	
};
