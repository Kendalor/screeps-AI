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
	var invasor = harmfulEnemies.filter((hostile) => hostile.owner.username == 'Invasor');
        
    if (enemies.length > 0 && harmfulEnemies.length == 0){
        console.log("Harmless enemy in room "+room.name+" !")
		console.log(harmfulEnemies);
	}else if (harmfulEnemies.length == 1){
        console.log("Harmful enemy in room "+room.name+" !")
		if (room.controller.level < 3){
			this.trySafeMode(room);
		}
	}
	else if (harmfulEnemies.length > 1){
		if (invasor.length > 0){
			console.log("NPC Invasion in room "+room.name+" !")
			if (room.controller.level < 3)
				this.trySafeMode(room);
		} else{
			console.log("Player Invasion in room "+room.name+" !")
			this.trySafeMode(room);
		}
	}
  },
  
  trySafeMode: function(room){
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
  }
};
