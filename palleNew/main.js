var PROTOTYPES = require('prototypes')();

module.exports.loop = function () {
    for(var name in Game.rooms) {
		var room = Game.rooms[name];
		var spawnList = (room.find(FIND_MY_STRUCTURES,{filter: (structure) => structure.structureType == STRUCTURE_SPAWN}));
		for(var id in spawnList) {
			var spawn = spawnList[id];
			spawn.createCustomCreep(1,2);
		}
  }
}