var WHITELIST = {'Kendalor' : true,'Palle' : true};

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
	
	// Console Info
	if (Game.time % 50 == 0){
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
		var towers = room.find(FIND_MY_STRUCTURES,{filter: (struct) => struct.structureType == STRUCTURE_TOWER && struct.energy > 200});
		if (towers.length == 0){ // TOWER DEFENSE AVAILABLE?
			this.trySafeMode(room);
		}
	}
  },
  
	trySafeMode: function(room){
		if (room.controller != undefined){
			var safeMode = room.controller.safeMode
			if (safeMode == undefined){//enemyPresent and safemode off
				if (room.controller.safeModeAvailable){//safemode available
					console.log("Safemode activated in room "+room.name+" !")
					room.controller.activateSafeMode()
				}
				else{
					console.log("No safemode available in room "+room.name+" !")
				}
			}
			else{
				console.log("Safemode activated in room "+room.name+" : "+safeMode+" !")
			}
		}else console.log("No controller")
	}
	
};
