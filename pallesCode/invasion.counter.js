module.exports = {
  /** @param {towerList} towerList **/
  run: function(room) {
    var enemyPresent = room.find(FIND_HOSTILE_CREEPS,{filter: (hostile) => hostile.owner.username != 'Invader' && hostile.owner.username != 'Kendalor' && hostile.owner.username != 'Source Keeper'}).length > 0;
      if (enemyPresent){
      console.log("Invasion in room "+room.name+" !")
      if (enemyPresent && room.controller.safeMode == undefined){//enemyPresent and safemode off
        if (room.controller.safeModeAvailable){//safemode available
          room.controller.activateSafeMode()
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