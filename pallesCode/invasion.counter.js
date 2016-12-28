var WHITELIST = {'Kendalor' : true,'Palle' : true};

module.exports = {
  /** @param {towerList} towerList **/
  run: function(room) {
    var enemies = room.find(FIND_HOSTILE_CREEPS,{filter: (hostile) =>
          WHITELIST[hostile.owner.username] == undefined 
        });
    var harmfulEnemies = room.find(enemies,{filter: (hostile) =>
          hostile.body.filter((body) => body.type == 'attack' || body.type == 'ranged_attack').length > 0
        });
        
    if (enemies.length > 0){
        console.log("Harmless enemy in room "+room.name+" !")
      if (harmfulEnemies.length == 1){
        console.log("Harmful enemy in room "+room.name+" !")
      }
      else if (harmfulEnemies.length > 1){
        console.log("Invasion in room "+room.name+" !")
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
    }
  },
  
  placeWalls: function(room){
    var exitList = Game.map.describeExits(room);
    //console.log(exitList);
    room.memory.walls == true;
  }
};